# AI Life Manager

A local-first day planner that schedules tasks around energy, meals, movement, hydration, and rest. It can also call OpenAI through a tiny local backend, so your API key never goes into the browser.

## Run locally

Local-only mode:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

AI-enabled mode:

```powershell
$env:OPENAI_API_KEY="your_api_key"
node server.js
```

Or create a local `.env` file:

```text
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-5.1-mini
```

Then open `http://127.0.0.1:4173/`.

The app stores tasks and preferences in `localStorage`.

Optional: set `OPENAI_MODEL` to override the default API model. If the API call is unavailable, Jayden falls back to the local planner instead of leaving the AI controls blank.

## What it does

- Prioritizes tasks with urgency, importance, energy need, and current energy.
- Builds a timeline between wake and sleep times.
- Adds care blocks for meals, water, movement, and rest.
- Lets you mark items done, delay blocks, clear completed tasks, and enable browser notifications.
- Uses AI replan to request structured task priorities, risk level, and coaching nudges.
