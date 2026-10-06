# Hockey — прогноз матчей NHL

Веб-приложение (React 19 + TypeScript + Vite), которое прогнозирует исход матча NHL:
вероятности победы, вероятный счёт и тотал. Считается прямо в браузере — без бэкенда.

## Как работает

Схема: **данные → модель → рынок → купон**.

1. **Данные.** `src/data/games.json` — результаты матчей NHL (2 прошлых сезона + текущий)
   с официального открытого API `api-web.nhle.com`. `src/data/odds.json` — коэффициенты
   букмекеров с Oddsportal (собраны через [OddsHarvester](https://github.com/jordantete/OddsHarvester)).
2. **Модель** (`src/model/model.ts`):
   - **Elo** — рейтинги силы команд с домашним преимуществом и регрессией к среднему в новом сезоне;
   - **Пуассон** — силы атаки/защиты по забитым/пропущенным (вес свежести, полураспад 180 дней),
     отсюда вероятности исходов, вероятный счёт и тотал;
   - **дни отдыха** (по датам матчей) и **разница часовых поясов** (фактор перелёта) — корректируют λ голов;
   - **walk-forward бэктест**, метрики **Brier** и **log-loss** (модель против рынка).
3. **Рынок.** Если для пары команд есть кэфы, приложение показывает вероятности по рынку и
   **блендит** их с моделью (ползунок «вес рынка»).
4. **Купон** (`src/components/Bankroll.tsx`). По матчам дня считается, **на что и сколько ставить**:
   рынок **тотал 5.5** (Больше/Меньше), оценка **EV** = вероятность × кэф − 1, размер по
   **критерию Келли** или режим **«максимум вероятности плюса»**, лимит риска за день,
   минимум ставки **50 ₽**, и показ **вероятности выйти в плюс**.

## Стек

- **Фронтенд:** React 19, TypeScript, Vite; чистый CSS; oxlint; Vitest + Testing Library.
- **Состояние:** хуки React + `localStorage` (настройки банка и ставок переживают перезагрузку).
- **Данные:** official NHL API (`api-web.nhle.com`); Oddsportal через OddsHarvester (Python + Playwright).
- **Сбор/конвертация:** Node.js (`scripts/fetch-nhl.mjs`), Python (`scripts/convert_odds.py`).
- **Модели:** Elo, Пуассон, критерий Келли, де-виг кэфов.
- **Проверка UI:** Playwright (headless Chrome) для скриншотов.

## Скриншоты

В папке [`screenshots/`](screenshots):

- `01-prediction.png` — прогноз матча: исходы, тотал, рынок и блендинг;
- `02-matches.png` — матчи дня с результатами и проверкой прогноза (✓/✗);
- `03-coupon.png` — купон ставок, сравнение стратегий и распределение банка.

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
```

## Обновление данных

**Результаты матчей** (NHL API, CORS не даёт браузеру — собираем заранее):

```bash
npm run fetch:nhl   # -> src/data/games.json
```

**Коэффициенты** (Oddsportal через OddsHarvester, Python):

```bash
pip install oddsharvester
python -m playwright install chromium

# ближайшие матчи: исход, тотал, двойной шанс
oddsharvester upcoming -s ice-hockey -l nhl -m home_away --headless -f json -o nhl_upcoming.json
oddsharvester upcoming -s ice-hockey -l nhl -m over_under_5_5 --headless -f json -o nhl_ou.json
oddsharvester upcoming -s ice-hockey -l nhl -m double_chance --headless -f json -o nhl_dc.json
# объединить и конвертировать в src/data/odds.json
python scripts/convert_odds.py nhl_upcoming.json nhl_ou.json nhl_dc.json
```

> Исторический сбор Oddsportal (`historic`) нестабилен: пагинация может зависать.
> Ближайшие матчи (`upcoming`) собираются надёжно.

## Структура

```
scripts/fetch-nhl.mjs       — сбор матчей с NHL API
scripts/convert_odds.py     — конвертер выгрузок OddsHarvester в odds.json
src/model/model.ts          — Elo, Пуассон, отдых, таймзоны
src/model/odds.ts           — поиск кэфов и блендинг
src/components/PredictionView.tsx — панель прогноза
src/data/games.json         — результаты матчей
src/data/odds.json          — коэффициенты
src/App.tsx, main.tsx, index.css
```

## Ограничения

- Elo/Пуассон — базовая модель; тренд и сезонность учтены слабо, без xG и составов.
- Рынок в среднем точнее модели (по Brier/log-loss), поэтому ставки «против рынка» рискованны.
- Кэфов собрано немного (десятки матчей); исторический сбор Oddsportal нестабилен.
- «Гарантированного» плюса не бывает — везде вероятность, а не гарантия. Авто-обновления данных нет: сбор запускается вручную.
