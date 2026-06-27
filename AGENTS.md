# AGENTS.md

## Purpose

This repo is a fully static browser instrument.

It is a probabilistic sample player built around a master clock and Markov-chain
sample nodes. Treat it as an interactive music tool, not a backend app.

## Stack

- Vite
- React
- TypeScript
- React Flow
- Web Audio API
- Vitest

## Repo Structure

- `src/App.tsx`
  - Main application shell.
  - Owns React Flow state, transport state, selection, and high-level editing
    actions.
- `src/components/`
  - Custom React Flow node and edge renderers.
  - `ClockNode.tsx` renders the master clock.
  - `MarkovNode.tsx` renders sample nodes.
  - `ProbabilityEdge.tsx` renders clock and transition edges.
- `src/lib/`
  - Pure helpers and testable behavior.
  - `clock.ts` contains clock division, lane, and timing helpers.
  - `markov.ts` contains Markov transition selection.
  - `probability.ts` contains probability normalization and redistribution.
  - `edgeRouting.ts` contains edge path routing.
  - `persistence.ts` contains LocalStorage patch loading and sanitization.
  - `audioEngine.ts` owns generated Web Audio sample playback.
- `src/types.ts`
  - Shared graph, node, edge, clock, and sample types/constants.
- `README.md`
  - User-facing project overview and commands.

## Architecture

The graph has two edge kinds:

- Clock edges
  - Originate from the master clock node.
  - Route to sample node inputs.
  - Carry a clock division: whole, quarter, eighth, or sixteenth.
  - Do not participate in probability normalization.
- Transition edges
  - Connect sample nodes to sample nodes.
  - Carry probabilities.
  - Are normalized per source node so outgoing probabilities sum to `1`.

Playback runs on a sixteenth-note master grid. Clock lanes fire when their
division is due. Every clock edge owns an independent Markov lane, so multiple
clock outputs can fire simultaneously.

## Interaction Invariants

- Runtime graph editing is allowed while playback runs.
- Graph edits affect future ticks only.
- Already playing audio voices must not be interrupted by graph edits.
- The master clock node is movable but must remain undeletable.
- Sample nodes can be added, moved, edited, deleted, and rerouted at runtime.
- Existing edge endpoints can be reconnected at runtime.
- Clock edges and transition edges must stay semantically separate.
- Probability edits must be picked up by the next Markov decision.
- Deleting a clock edge removes that playback lane.
- Adding a clock edge creates a lane that starts on its next scheduled tick.
- If an active lane’s current node is deleted, reset it to that lane’s clock
  target if still valid.

## Ports And Routing

Sample node ports are disciplined:

- Left port is input.
- Right port is output.
- Top port is self-loop.

The master clock has four output ports:

- Whole
- Quarter
- Eighth
- Sixteenth

Edges should route around nodes, not through them. Preserve the custom routing
logic in `edgeRouting.ts` when modifying edge visuals.

## Coding Guidance

- Prefer existing helpers in `src/lib` before adding new state logic.
- Keep domain behavior pure and covered by focused tests when practical.
- Keep React components responsible for rendering and interaction wiring.
- Avoid broad refactors unless the user asks.
- Avoid new dependencies unless they clearly reduce complexity.
- Keep UI controls dense, functional, and instrument-like.
- Do not create marketing-style pages or explanatory onboarding screens.
- Do not commit `dist/` or `node_modules/`.

## Verification

Before handing off code changes, run:

```bash
npm test
npm run build
```

For docs-only changes, tests are optional. Say explicitly if you did not run
them.
