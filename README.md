# mcsquared

A fully static probabilistic sample player built around clocked Markov chains.

`mcsquared` is a browser-based graph instrument: a movable master clock drives sample nodes through user-routed probability edges. Each node can play one of eight generated Web Audio samples, then transition to another node according to its outgoing edge probabilities.

## Features

- Static Vite + React + TypeScript app.
- Canvas graph editor powered by React Flow.
- Draggable sample nodes with left input, right output, and top self-loop ports.
- Undeletable master clock node with four outputs:
  - Whole notes
  - Quarter notes
  - Eighth notes
  - Sixteenth notes
- Simultaneous clock lanes on a shared sixteenth-note grid.
- Up to 64 sample nodes.
- Eight generated Web Audio sample voices, no bundled audio assets required.
- Runtime graph editing while playback is running.
- Live probability editing with sliders or mouse wheel on a selected transition edge.
- LocalStorage patch persistence.

## How It Works

The master clock is a graph node. Route any of its outputs to sample nodes to create playback lanes. Each lane keeps its own Markov-chain state and fires on its clock division:

- Whole fires every 16 sixteenth ticks.
- Quarter fires every 4 sixteenth ticks.
- Eighth fires every 2 sixteenth ticks.
- Sixteenth fires every tick.

When divisions line up, their lanes fire together. Graph edits affect future ticks only; audio that has already started is not interrupted.

Transition edges between sample nodes hold probabilities. For each source node, outgoing transition probabilities are normalized to sum to `1`. Changing one edge redistributes the remaining probability across sibling edges.

## Usage

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Editing Controls

- Drag sample tiles onto the canvas to create nodes.
- Connect clock outputs to sample node inputs to start lanes.
- Connect sample node outputs to sample node inputs to create transitions.
- Connect the top self port to itself for a visible self-loop.
- Select a transition edge and use the inspector or mouse wheel to change probability.
- Hold `Shift` while scrolling a selected transition edge for larger probability steps.
- Nodes and edges can be edited, moved, deleted, and rerouted while playback is running.
- The master clock can be moved but cannot be deleted.

## Tech Stack

- React
- TypeScript
- Vite
- React Flow
- Web Audio API
- Vitest
