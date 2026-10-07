# Hockey — прогноз матчей NHL

Веб-приложение (React 19 + TypeScript + Vite), которое прогнозирует исходы матчей NHL:
вероятности победы, вероятный счёт и ожидаемый тотал. Всё считается прямо в браузере,
без бэкенда — данные лежат в JSON, модель работает на клиенте.

## Как работает

Схема: **данные → модель → рынок → купон**.

1. **Данные.** `src/data/games.json` — результаты матчей NHL (2 прошлых сезона + текущий)
   с открытого API `api-web.nhle.com`. `src/data/schedule.json` — предстоящие матчи (календарь
   NHL, ещё не завершённые). `src/data/advanced.json` — статистика 5v5 (голы и броски/Corsi)
   из play-by-play NHL. `src/data/odds.json` — коэффициенты букмекеров с
   Oddsportal (собраны через [OddsHarvester](https://github.com/jordantete/OddsHarvester)).
2. **Модель** (`src/model/model.ts`):
   - **Elo** — рейтинги силы команд, домашнее преимущество, регрессия к среднему в новом сезоне;
     итоговый исход — ансамбль Пуассона и Elo (вес `eloWeight`);
   - **Пуассон** — силы атаки/защиты с весом свежести (полураспад 90 дней) и лёгкой регуляризацией
     к среднему лиги (shrinkage). Сила считается по **xG в равных составах (5v5)** —
     по координатам броска (дистанция/защита), это устойчивее голов; отсюда вероятности исходов,
     вероятный счёт и тотал;
   - **дни отдыха** и **разница часовых поясов** (фактор перелёта) корректируют λ голов;
   - **walk-forward бэктест** и метрики **Brier** / **log-loss** (модель против рынка).
     Walk-forward считается **той же взвешенной моделью**, что и боевой прогноз
     (вес с полураспадом), с точкой отсчёта на каждый матч — без заглядывания в будущее.
3. **Рынок.** Если для пары команд есть кэфы, показываются вероятности по рынку и их
   **блендинг** с моделью (ползунок «вес рынка»).
4. **Списки матчей** (`src/components/MatchList.tsx`). Матчи сгруппированы по игровым дням.
   «Ближайшие матчи» строятся по календарю NHL (`schedule.json`), а кэф подтягивается к ним по
   паре команд (±1 день) — иначе поздние матчи уезжали на сутки из-за часового пояса Oddsportal.
   Внутри дня **красной рамкой + ★** отмечается **самый уверенный** матч, но только если
   модель и рынок согласны на фаворите **и** уверенность модели **не ниже** порога
   (ползунок «Уверенность модели для красной рамки», по умолчанию **65%**).
5. **Купон** (`src/components/Bankroll.tsx`). По матчам дня считается, **на что и сколько ставить**:
   ставки на **победу хозяев/гостей с учётом ОТ/буллитов** (двузначный рынок), оценка
   **EV** = вероятность × кэф − 1, размер по **критерию Келли** либо режим
   **«максимум вероятности плюса»** или **«размазать по всем»**, лимит риска за день,
   минимум ставки **50 ₽**, показ **вероятности выйти в плюс**.

## Стек

- **Фронтенд:** React 19, TypeScript, Vite; чистый CSS; oxlint; Vitest.
- **Состояние:** хуки React + `localStorage` (настройки банка, порогов и отображения, а также
  выбранные «суперматчи» дня — рамка/★ переезжают из предстоящих в прошедшие; переживают
  перезагрузку).
- **Данные:** официальный NHL API (`api-web.nhle.com`); Oddsportal через OddsHarvester
  (Python + Playwright).
- **Сбор/конвертация:** Node.js (`scripts/fetch-nhl.mjs`), Python (`scripts/convert_odds.py`),
  dev-плагин Vite (`scripts/dev-refresh-plugin.mjs`).
- **Модели:** Elo, Пуассон, критерий Келли, де-виг кэфов.

## Скриншоты

В папке [`screenshots/`](screenshots):

- `01-prediction.png` — прогноз матча: исходы, тотал, рынок и блендинг;
- `02-upcoming.png` — ближайшие матчи по дням, красная рамка ★ на супер-матче;
- `03-past.png` — прошедшие матчи текущего сезона (аккордеон по дням);
- `04-coupon.png` — купон ставок, сравнение стратегий и распределение банка.

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173/
```

## Сборка и проверки

```bash
npm run build      # production-сборка
npm run preview    # локальный просмотр сборки
npm test           # тесты модели (Vitest)
npm run lint       # линтер oxlint
npm run typecheck  # проверка типов
npm run tune       # подбор гиперпараметров (walk-forward Brier/log-loss)
```

## Обновление данных

**Результаты матчей** (NHL API, CORS не даёт браузеру — собираем заранее):

```bash
npm run fetch:nhl            # 3 сезона -> src/data/games.json + предстоящие -> schedule.json
npm run fetch:nhl:current    # только текущий сезон (прошлые берутся из файла)
npm run fetch:advanced       # play-by-play -> 5v5-голы и броски -> src/data/advanced.json
```

**Коэффициенты** (Oddsportal через OddsHarvester, Python):

```bash
pip install oddsharvester
python -m playwright install chromium

# предстоящие матчи: исход и тотал 5.5
oddsharvester upcoming -s ice-hockey -l nhl -m home_away,over_under_5_5 \
  --headless -f json -o nhl_upcoming.json \
  --base-url https://www.centroquote.it --locale it-IT --timezone Europe/Rome
# конвертировать (сливается с уже собранными кэфами)
python scripts/convert_odds.py nhl_upcoming.json
```

> **Важно про домен.** Основной `www.oddsportal.com` из многих сетей недоступен
> (TLS-соединение виснет). Рабочее зеркало — `www.centroquote.it` (итальянский домен
> OddsPortal). Задаётся через `--base-url` или переменную окружения.
>
> Исторический сбор (`historic`) нестабилен: пагинация может зависать. Надёжно
> собираются предстоящие матчи (`upcoming`).
>
> `scripts/convert_odds.py` **не перезаписывает** `odds.json`, а сливает записи по
> (дата, команды): ранее собранные кэфы сохраняются и остаются доступны, когда матч
> становится прошедшим.

**Обновление из интерфейса (только dev).** В режиме `npm run dev` работает эндпоинт
`/api/refresh` (SSE) и кнопка «Обновить данные»: сначала матчи (`fetch-nhl.mjs`), затем
кэфы (OddsHarvester + `convert_odds.py`). Если данные старше часа, обновление запускается
автоматически. Плагин `apply: 'serve'` — в production-сборке кнопка недоступна.

**Переменные окружения** для сборщика кэфов:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `HOCKEY_PYTHON` | `python` | интерпретатор Python |
| `HOCKEY_ODDSHARVESTER` | `oddsharvester` | команда OddsHarvester |
| `HOCKEY_ODDS_BASE_URL` | `https://www.centroquote.it` | зеркало OddsPortal (только https) |
| `HOCKEY_ODDS_LOCALE` | `it-IT` | локаль браузера |
| `HOCKEY_ODDS_TIMEZONE` | `Europe/Rome` | часовой пояс браузера |

## Структура

```
scripts/fetch-nhl.mjs            — сбор матчей и предстоящих игр с NHL API
scripts/fetch-advanced.mjs       — сбор 5v5 (голы/Corsi) из play-by-play NHL
scripts/tune.mjs                 — подбор гиперпараметров модели (walk-forward Brier/log-loss)
scripts/convert_odds.py          — конвертер выгрузок OddsHarvester -> odds.json (со слиянием)
scripts/dev-refresh-plugin.mjs   — dev-эндпоинт /api/refresh (матчи + кэфы), кнопка в UI
src/model/model.ts               — Elo, Пуассон, отдых, таймзоны, walk-forward
src/model/odds.ts                — поиск кэфов и блендинг с моделью
src/utils/settings.ts            — настройки в localStorage
src/components/PredictionView.tsx — панель прогноза матча
src/components/MatchList.tsx     — списки матчей (группировка по дням, красная рамка)
src/components/Bankroll.tsx      — купон, стратегии, дополнительные настройки
src/components/DataRefresh.tsx   — кнопка и статус обновления данных
src/data/games.json              — результаты матчей
src/data/schedule.json           — предстоящие матчи (календарь NHL)
src/data/advanced.json           — 5v5 голы и броски (Corsi) из play-by-play
src/data/odds.json               — коэффициенты (накапливаются)
src/data/updated.json            — время последнего полного обновления
src/App.tsx, main.tsx, index.css
```

## Ограничения

- Elo/Пуассон — базовая модель: тренд и сезонность учтены слабо, без xG и составов.
- Рынок в среднем точнее модели (по Brier/log-loss), поэтому ставки «против рынка» рискованны.
- Кэфов собрано немного (десятки матчей); сбор зависит от доступности зеркала OddsPortal.
- Кэфы **накапливаются** вперёд: матчи, сыгранные до первого успешного сбора, остаются без рынка.
- «Гарантированного» плюса не бывает — везде вероятность, а не гарантия.
