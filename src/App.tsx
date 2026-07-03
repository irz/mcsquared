import {
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  MarkerType,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams
} from "@xyflow/react";
import {
  Link2,
  MousePointer2,
  Plus,
  RotateCcw,
  Shuffle,
  Square,
  Trash2,
  Volume2,
  Play
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClockNode } from "./components/ClockNode";
import { MarkovNode } from "./components/MarkovNode";
import { ProbabilityEdge } from "./components/ProbabilityEdge";
import { SwingNode } from "./components/SwingNode";
import {
  clockDivisionFromHandle,
  clockDivisionLabels,
  clockLanes,
  divisionsForSixteenthTick,
  isClockEdge,
  isTransitionEdge,
  reconcileClockLaneNodes,
  sixteenthIntervalMs
} from "./lib/clock";
import { chooseNextNodeId } from "./lib/markov";
import {
  addEdgeWithProbability,
  normalizeEdgesBySource,
  probabilityPercent,
  setEdgeProbability
} from "./lib/probability";
import { loadStoredPatch, saveStoredPatch } from "./lib/persistence";
import { SampleEngine } from "./lib/audioEngine";
import {
  DEFAULT_SWING_AMOUNT,
  DEFAULT_SWING_CHANCE,
  clampSwingAmount,
  clampSwingChance,
  swingDelaySeconds
} from "./lib/swing";
import {
  MAX_BPM,
  MAX_NODES,
  MASTER_CLOCK_NODE_ID,
  MIN_BPM,
  NODE_PORTS,
  CLOCK_PORTS,
  SAMPLE_IDS,
  SWING_PORTS,
  type AppEdge,
  type AppNode,
  type ClockDivision,
  type NumberedSampleId,
  type PatchState,
  type SampleId
} from "./types";
import "./App.css";

const sampleNames: Record<NumberedSampleId, string> = {
  1: "Kick",
  2: "Snare",
  3: "Hat",
  4: "Clap",
  5: "Tom",
  6: "Pluck",
  7: "Bell",
  8: "Chord"
};

const nodeTypes = { markovNode: MarkovNode, clockNode: ClockNode, swingNode: SwingNode };
const edgeTypes = { probabilityEdge: ProbabilityEdge };

const markerEnd = {
  type: MarkerType.ArrowClosed,
  color: "#3e3a36",
  width: 18,
  height: 18
} as const;

const clockOutputHandles = new Set<string>([
  CLOCK_PORTS.WHOLE,
  CLOCK_PORTS.QUARTER,
  CLOCK_PORTS.EIGHTH,
  CLOCK_PORTS.SIXTEENTH
]);

const SCHEDULE_AHEAD_SECONDS = 0.12;
const SCHEDULER_LOOKAHEAD_MS = 25;

const createClockNode = (bpm: number): AppNode => ({
  id: MASTER_CLOCK_NODE_ID,
  type: "clockNode",
  position: { x: -120, y: 150 },
  data: {
    label: "Master Clock",
    bpm
  }
});

const createId = (prefix: string) => {
  if ("crypto" in globalThis && "randomUUID" in globalThis.crypto) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const createEdge = (connection: Connection): AppEdge | null => {
  if (!connection.source || !connection.target) {
    return null;
  }

  const isMasterClockConnection = connection.source === MASTER_CLOCK_NODE_ID;
  const isSwingClockConnection = connection.sourceHandle === SWING_PORTS.OUTPUT;
  const isClockConnection = isMasterClockConnection || isSwingClockConnection;
  const isSelfEdge = connection.source === connection.target;
  const clockDivision = clockDivisionFromHandle(connection.sourceHandle);

  return {
    id: createId("edge"),
    source: connection.source,
    target: connection.target,
    sourceHandle: isClockConnection
      ? isSwingClockConnection
        ? SWING_PORTS.OUTPUT
        : connection.sourceHandle
      : isSelfEdge
        ? NODE_PORTS.SELF_SOURCE
        : NODE_PORTS.OUTPUT,
    targetHandle: isSelfEdge
      ? NODE_PORTS.SELF_TARGET
      : connection.targetHandle === SWING_PORTS.INPUT
        ? SWING_PORTS.INPUT
        : NODE_PORTS.INPUT,
    type: "probabilityEdge",
    markerEnd,
    data: isMasterClockConnection
      ? { edgeKind: "clock", clockDivision: clockDivision ?? "quarter" }
      : isSwingClockConnection
        ? { edgeKind: "clock" }
      : { edgeKind: "transition", probability: 0 }
  };
};

const isDisciplinedConnection = (connection: {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}) => {
  if (!connection.source || !connection.target) {
    return false;
  }

  const isSelfEdge = connection.source === connection.target;

  if (connection.source === MASTER_CLOCK_NODE_ID) {
    return (
      connection.target !== MASTER_CLOCK_NODE_ID &&
      Boolean(connection.sourceHandle && clockOutputHandles.has(connection.sourceHandle)) &&
      (connection.targetHandle === NODE_PORTS.INPUT || connection.targetHandle === SWING_PORTS.INPUT)
    );
  }

  if (connection.target === MASTER_CLOCK_NODE_ID) {
    return false;
  }

  if (connection.targetHandle === SWING_PORTS.INPUT) {
    return false;
  }

  if (connection.sourceHandle === SWING_PORTS.OUTPUT) {
    return connection.source !== connection.target && connection.targetHandle === NODE_PORTS.INPUT;
  }

  if (isSelfEdge) {
    return (
      connection.sourceHandle === NODE_PORTS.SELF_SOURCE &&
      connection.targetHandle === NODE_PORTS.SELF_TARGET
    );
  }

  return (
    connection.sourceHandle === NODE_PORTS.OUTPUT && connection.targetHandle === NODE_PORTS.INPUT
  );
};

const hasDuplicateConnection = (
  edges: AppEdge[],
  connection: {
    source?: string | null;
    target?: string | null;
    sourceHandle?: string | null;
  },
  ignoredEdgeId?: string
) =>
  edges.some((edge) => {
    if (
      edge.id === ignoredEdgeId ||
      edge.source !== connection.source ||
      edge.target !== connection.target
    ) {
      return false;
    }

    if (connection.source === MASTER_CLOCK_NODE_ID) {
      return edge.sourceHandle === connection.sourceHandle;
    }

    return true;
  });

const withDisciplinedEdgeHandles = (edge: AppEdge): AppEdge => {
  if (isClockEdge(edge)) {
    if (edge.source !== MASTER_CLOCK_NODE_ID) {
      return {
        ...edge,
        sourceHandle: SWING_PORTS.OUTPUT,
        targetHandle: NODE_PORTS.INPUT,
        markerEnd: edge.markerEnd ?? markerEnd,
        data: {
          edgeKind: "clock"
        }
      };
    }

    const clockDivision = edge.data?.clockDivision ?? clockDivisionFromHandle(edge.sourceHandle);

    return {
      ...edge,
      sourceHandle:
        edge.sourceHandle && clockOutputHandles.has(edge.sourceHandle)
          ? edge.sourceHandle
          : CLOCK_PORTS.QUARTER,
      targetHandle: edge.targetHandle === SWING_PORTS.INPUT ? SWING_PORTS.INPUT : NODE_PORTS.INPUT,
      markerEnd: edge.markerEnd ?? markerEnd,
      data: {
        ...edge.data,
        edgeKind: "clock",
        clockDivision: clockDivision ?? "quarter"
      }
    };
  }

  const isSelfEdge = edge.source === edge.target;

  return {
    ...edge,
    sourceHandle: isSelfEdge ? NODE_PORTS.SELF_SOURCE : NODE_PORTS.OUTPUT,
    targetHandle: isSelfEdge ? NODE_PORTS.SELF_TARGET : NODE_PORTS.INPUT,
    markerEnd: edge.markerEnd ?? markerEnd,
    data: {
      ...edge.data,
      edgeKind: "transition",
      probability: edge.data?.probability ?? 1
    }
  };
};

const createInitialPatch = (): PatchState => {
  const nodes: AppNode[] = [
    createClockNode(112),
    {
      id: "node-kick",
      type: "markovNode",
      position: { x: 120, y: 160 },
      data: { label: "Kick", sampleId: 1 }
    },
    {
      id: "node-snare",
      type: "markovNode",
      position: { x: 430, y: 140 },
      data: { label: "Snare", sampleId: 2 }
    },
    {
      id: "node-hat",
      type: "markovNode",
      position: { x: 300, y: 360 },
      data: { label: "Hat", sampleId: 3 }
    }
  ];
  const edges: AppEdge[] = normalizeEdgesBySource([
    {
      id: "edge-clock-kick",
      source: MASTER_CLOCK_NODE_ID,
      target: "node-kick",
      type: "probabilityEdge",
      sourceHandle: CLOCK_PORTS.QUARTER,
      targetHandle: NODE_PORTS.INPUT,
      data: { edgeKind: "clock", clockDivision: "quarter" }
    },
    {
      id: "edge-kick-snare",
      source: "node-kick",
      target: "node-snare",
      type: "probabilityEdge",
      sourceHandle: NODE_PORTS.OUTPUT,
      targetHandle: NODE_PORTS.INPUT,
      data: { edgeKind: "transition", probability: 0.72 }
    },
    {
      id: "edge-kick-hat",
      source: "node-kick",
      target: "node-hat",
      type: "probabilityEdge",
      sourceHandle: NODE_PORTS.OUTPUT,
      targetHandle: NODE_PORTS.INPUT,
      data: { edgeKind: "transition", probability: 0.28 }
    },
    {
      id: "edge-snare-kick",
      source: "node-snare",
      target: "node-kick",
      type: "probabilityEdge",
      sourceHandle: NODE_PORTS.OUTPUT,
      targetHandle: NODE_PORTS.INPUT,
      data: { edgeKind: "transition", probability: 1 }
    },
    {
      id: "edge-hat-hat",
      source: "node-hat",
      target: "node-hat",
      type: "probabilityEdge",
      sourceHandle: NODE_PORTS.SELF_SOURCE,
      targetHandle: NODE_PORTS.SELF_TARGET,
      data: { edgeKind: "transition", probability: 0.45 }
    },
    {
      id: "edge-hat-kick",
      source: "node-hat",
      target: "node-kick",
      type: "probabilityEdge",
      sourceHandle: NODE_PORTS.OUTPUT,
      targetHandle: NODE_PORTS.INPUT,
      data: { edgeKind: "transition", probability: 0.55 }
    }
  ]).map(withDisciplinedEdgeHandles);

  return {
    version: 1,
    nodes,
    edges,
    bpm: 112
  };
};

const clampBpm = (value: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value)));

const clampProbability = (value: number) => Math.min(1, Math.max(0, value));

function App() {
  const initialPatch = useMemo(() => loadStoredPatch() ?? createInitialPatch(), []);
  const [nodes, setNodes] = useState<AppNode[]>(initialPatch.nodes);
  const [edges, setEdges] = useState<AppEdge[]>(initialPatch.edges);
  const [bpm, setBpm] = useState(initialPatch.bpm);
  const [activeNodeIds, setActiveNodeIds] = useState<string[]>([]);
  const [activeEdgeIds, setActiveEdgeIds] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const bpmRef = useRef(bpm);
  const activeLaneNodeIdsRef = useRef(new Map<string, string>());
  const engineRef = useRef(new SampleEngine());
  const { screenToFlowPosition } = useReactFlow();

  const selectedNode = nodes.find((node) => node.id === selectedNodeIds[0]);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeIds[0]);
  const selectedSourceNode = selectedEdge
    ? nodes.find((node) => node.id === selectedEdge.source)
    : undefined;
  const selectedTargetNode = selectedEdge
    ? nodes.find((node) => node.id === selectedEdge.target)
    : undefined;
  const selectedNodeOutgoingEdges = selectedNode
    ? edges.filter(
        (edge) => selectedNode.type === "markovNode" && edge.source === selectedNode.id && isTransitionEdge(edge)
      )
    : [];
  const editableNodes = nodes.filter((node) => node.id !== MASTER_CLOCK_NODE_ID);
  const markovNodes = nodes.filter((node) => node.type === "markovNode");
  const swingNodes = nodes.filter((node) => node.type === "swingNode");
  const validClockLanes = clockLanes(nodes, edges);
  const clockRouteCounts = validClockLanes.reduce<Record<ClockDivision, number>>(
    (counts, edge) => {
      counts[edge.clockDivision] += 1;
      return counts;
    },
    { whole: 0, quarter: 0, eighth: 0, sixteenth: 0 }
  );
  const activeClockOutputLabels = Object.entries(clockRouteCounts)
    .filter(([, count]) => count > 0)
    .map(([division, count]) => `${clockDivisionLabels[division as ClockDivision]} ${count}`)
    .join(", ");

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    saveStoredPatch({
      version: 1,
      nodes,
      edges,
      bpm
    });
  }, [nodes, edges, bpm]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const nextClockLanes = clockLanes(nodes, edges);
    activeLaneNodeIdsRef.current = reconcileClockLaneNodes(
      nextClockLanes,
      new Set(nodes.map((node) => node.id)),
      activeLaneNodeIdsRef.current
    );
    setActiveNodeIds(Array.from(new Set(activeLaneNodeIdsRef.current.values())));
    setActiveEdgeIds(Array.from(new Set(nextClockLanes.flatMap((lane) => lane.routeEdgeIds))));
  }, [edges, isPlaying, nodes]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let timerId: number | undefined;
    const visualTimerIds = new Set<number>();
    let cancelled = false;
    let sixteenthTickIndex = 0;
    let nextTickTime = engineRef.current.getCurrentTime();

    const scheduleVisualUpdate = (scheduledTime: number, nodeIds: string[], edgeIds: string[]) => {
      const delayMs = Math.max(0, (scheduledTime - engineRef.current.getCurrentTime()) * 1000);
      const visualTimerId = window.setTimeout(() => {
        visualTimerIds.delete(visualTimerId);

        if (cancelled) {
          return;
        }

        setActiveNodeIds(nodeIds);
        setActiveEdgeIds(edgeIds);
      }, delayMs);

      visualTimerIds.add(visualTimerId);
    };

    const tick = () => {
      const latestNodes = nodesRef.current;
      const latestEdges = edgesRef.current;
      const nodeIds = new Set(latestNodes.map((node) => node.id));
      const nodesById = new Map(latestNodes.map((node) => [node.id, node]));
      const latestClockLanes = clockLanes(latestNodes, latestEdges);
      let nextLaneNodeIds = reconcileClockLaneNodes(
        latestClockLanes,
        nodeIds,
        activeLaneNodeIdsRef.current
      );
      const currentTime = engineRef.current.getCurrentTime();

      while (nextTickTime < currentTime + SCHEDULE_AHEAD_SECONDS) {
        const dueDivisions = new Set(divisionsForSixteenthTick(sixteenthTickIndex));
        const firedEdgeIds = new Set<string>();
        let visualTime = nextTickTime;

        for (const lane of latestClockLanes) {
          if (!dueDivisions.has(lane.clockDivision) || !nodeIds.has(lane.targetNodeId)) {
            continue;
          }

          const activeNodeId = nodeIds.has(nextLaneNodeIds.get(lane.id) ?? "")
            ? nextLaneNodeIds.get(lane.id)!
            : lane.targetNodeId;
          const activeNode = nodesById.get(activeNodeId);
          const swingDelay = lane.swingNodeId
            ? swingDelaySeconds(
                bpmRef.current,
                lane.clockDivision,
                sixteenthTickIndex,
                lane.swingAmount,
                lane.swingChance
              )
            : 0;
          const scheduledTime = Math.max(
            nextTickTime + swingDelay,
            engineRef.current.getCurrentTime() + 0.002
          );

          if (activeNode?.data.sampleId) {
            engineRef.current.playSampleAt(activeNode.data.sampleId, scheduledTime);
          }

          nextLaneNodeIds.set(lane.id, chooseNextNodeId(activeNodeId, latestEdges));
          lane.routeEdgeIds.forEach((edgeId) => firedEdgeIds.add(edgeId));
          visualTime = Math.max(visualTime, scheduledTime);
        }

        activeLaneNodeIdsRef.current = nextLaneNodeIds;

        if (firedEdgeIds.size > 0) {
          scheduleVisualUpdate(
            visualTime,
            Array.from(new Set(nextLaneNodeIds.values())),
            Array.from(firedEdgeIds)
          );
        }

        nextTickTime += sixteenthIntervalMs(bpmRef.current) / 1000;
        sixteenthTickIndex += 1;
      }

      if (!cancelled) {
        timerId = window.setTimeout(tick, SCHEDULER_LOOKAHEAD_MS);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
      for (const visualTimerId of visualTimerIds) {
        window.clearTimeout(visualTimerId);
      }
      visualTimerIds.clear();
    };
  }, [isPlaying]);

  const activeNodeIdSet = useMemo(() => new Set(activeNodeIds), [activeNodeIds]);
  const activeEdgeIdSet = useMemo(() => new Set(activeEdgeIds), [activeEdgeIds]);

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isActive: activeNodeIdSet.has(node.id),
          bpm: node.id === MASTER_CLOCK_NODE_ID ? bpm : node.data.bpm
        },
        draggable: true,
        connectable: true,
        selectable: true,
        deletable: node.id !== MASTER_CLOCK_NODE_ID
      })),
    [activeNodeIdSet, bpm, nodes]
  );

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...withDisciplinedEdgeHandles(edge),
        animated:
          isPlaying &&
          (activeNodeIdSet.has(edge.source) ||
            (isClockEdge(edge) && activeEdgeIdSet.has(edge.id))),
        selectable: true,
        reconnectable: true
      })),
    [activeEdgeIdSet, activeNodeIdSet, edges, isPlaying]
  );

  const addNodeAt = useCallback(
    (position: { x: number; y: number }, sampleId: SampleId = null) => {
      if (editableNodes.length >= MAX_NODES) {
        return;
      }

      const nodeId = createId("node");
      const nextNode: AppNode = {
        id: nodeId,
        type: "markovNode",
        position,
        data: {
          label: `Node ${markovNodes.length + 1}`,
          sampleId
        }
      };

      setNodes((previousNodes) => [...previousNodes, nextNode]);
      setSelectedNodeIds([nodeId]);
      setSelectedEdgeIds([]);
    },
    [editableNodes.length, markovNodes.length]
  );

  const addNode = useCallback(() => {
    addNodeAt({
      x: 140 + (editableNodes.length % 8) * 52,
      y: 120 + (editableNodes.length % 6) * 46
    });
  }, [addNodeAt, editableNodes.length]);

  const addSwingNode = useCallback(() => {
    if (editableNodes.length >= MAX_NODES) {
      return;
    }

    const nodeId = createId("swing");
    const nextNode: AppNode = {
      id: nodeId,
      type: "swingNode",
      position: {
        x: 220 + (editableNodes.length % 7) * 56,
        y: 180 + (editableNodes.length % 5) * 52
      },
      data: {
        label: `Swing ${swingNodes.length + 1}`,
        swingAmount: DEFAULT_SWING_AMOUNT,
        swingChance: DEFAULT_SWING_CHANCE
      }
    };

    setNodes((previousNodes) => [...previousNodes, nextNode]);
    setSelectedNodeIds([nodeId]);
    setSelectedEdgeIds([]);
  }, [editableNodes.length, swingNodes.length]);

  const onNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      const safeChanges = changes.filter(
        (change) => !(change.type === "remove" && change.id === MASTER_CLOCK_NODE_ID)
      );
      const removedNodeIds = new Set(
        safeChanges
          .filter((change) => change.type === "remove")
          .map((change) => change.id)
      );

      setNodes((previousNodes) => {
        return applyNodeChanges(safeChanges, previousNodes);
      });

      if (removedNodeIds.size > 0) {
        setEdges((previousEdges) =>
          normalizeEdgesBySource(
            previousEdges.filter(
              (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)
            )
          )
        );
      }
    },
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<AppEdge>[]) => {
      const removedEdgeIds = new Set(
        changes
          .filter((change) => change.type === "remove")
          .map((change) => change.id)
      );

      setEdges((previousEdges) => {
        const nextEdges = applyEdgeChanges(changes, previousEdges);
        return removedEdgeIds.size > 0 ? normalizeEdgesBySource(nextEdges) : nextEdges;
      });
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      if (!isDisciplinedConnection(connection)) {
        return;
      }

      if (hasDuplicateConnection(edges, connection)) {
        return;
      }

      const newEdge = createEdge(connection);

      if (!newEdge) {
        return;
      }

      setEdges((previousEdges) => addEdgeWithProbability(previousEdges, newEdge));
      setSelectedEdgeIds([newEdge.id]);
      setSelectedNodeIds([]);
    },
    [edges]
  );

  const onReconnect = useCallback(
    (oldEdge: AppEdge, connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        !isDisciplinedConnection(connection) ||
        hasDuplicateConnection(edges, connection, oldEdge.id)
      ) {
        return;
      }

      const replacementEdge = createEdge(connection);

      if (!replacementEdge) {
        return;
      }

      const replacementData = replacementEdge.data ?? {
        edgeKind: "transition" as const,
        probability: 0
      };
      const nextEdge: AppEdge = {
        ...replacementEdge,
        id: oldEdge.id,
        selected: true,
        data:
          isTransitionEdge(oldEdge) && replacementData.edgeKind === "transition"
            ? {
                ...replacementData,
                edgeKind: "transition",
                probability:
                  oldEdge.source === replacementEdge.source ? oldEdge.data?.probability ?? 1 : 0
              }
            : replacementData
      };

      setEdges((previousEdges) => {
        if (isTransitionEdge(oldEdge) && isTransitionEdge(nextEdge) && oldEdge.source === nextEdge.source) {
          return normalizeEdgesBySource(
            previousEdges.map((edge) => (edge.id === oldEdge.id ? nextEdge : edge))
          );
        }

        const edgesWithoutOld = normalizeEdgesBySource(
          previousEdges.filter((edge) => edge.id !== oldEdge.id)
        );

        return isTransitionEdge(nextEdge)
          ? addEdgeWithProbability(edgesWithoutOld, nextEdge)
          : [...edgesWithoutOld, nextEdge];
      });
      setSelectedEdgeIds([nextEdge.id]);
      setSelectedNodeIds([]);
    },
    [edges]
  );

  const onSelectionChange = useCallback((selection: OnSelectionChangeParams<AppNode, AppEdge>) => {
    setSelectedNodeIds(selection.nodes.map((node) => node.id));
    setSelectedEdgeIds(selection.edges.map((edge) => edge.id));
  }, []);

  const deleteSelected = useCallback(() => {
    const nodeIdsToDelete = new Set(
      selectedNodeIds.filter((nodeId) => nodeId !== MASTER_CLOCK_NODE_ID)
    );
    const edgeIdsToDelete = new Set(selectedEdgeIds);

    setNodes((previousNodes) => {
      const nextNodes = previousNodes.filter((node) => !nodeIdsToDelete.has(node.id));

      return nextNodes;
    });
    setEdges((previousEdges) =>
      normalizeEdgesBySource(
        previousEdges.filter(
          (edge) =>
            !edgeIdsToDelete.has(edge.id) &&
            !nodeIdsToDelete.has(edge.source) &&
            !nodeIdsToDelete.has(edge.target)
        )
      )
    );
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
  }, [selectedEdgeIds, selectedNodeIds]);

  const updateSelectedNodeData = useCallback(
    (updates: Partial<AppNode["data"]>) => {
      if (!selectedNode) {
        return;
      }

      setNodes((previousNodes) =>
        previousNodes.map((node) =>
          node.id === selectedNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...updates
                }
              }
            : node
        )
      );
    },
    [selectedNode]
  );

  const setProbability = useCallback(
    (edgeId: string, probability: number) => {
      setEdges((previousEdges) => setEdgeProbability(previousEdges, edgeId, probability));
    },
    []
  );

  const clearGraph = useCallback(() => {
    setNodes((previousNodes) => {
      const clockNode =
        previousNodes.find((node) => node.id === MASTER_CLOCK_NODE_ID) ?? createClockNode(bpm);

      return [clockNode];
    });
    setEdges([]);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setActiveNodeIds([]);
    setActiveEdgeIds([]);
    activeLaneNodeIdsRef.current.clear();
  }, [bpm]);

  const startPlayback = useCallback(() => {
    const validLanes = clockLanes(nodes, edges);

    if (isPlaying || validLanes.length === 0) {
      return;
    }

    activeLaneNodeIdsRef.current = new Map(
      validLanes.map((lane) => [lane.id, lane.targetNodeId])
    );
    setActiveNodeIds(Array.from(new Set(validLanes.map((lane) => lane.targetNodeId))));
    setActiveEdgeIds(Array.from(new Set(validLanes.flatMap((lane) => lane.routeEdgeIds))));
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);

    void engineRef.current.start().then(() => {
      setIsPlaying(true);
    });
  }, [edges, isPlaying, nodes]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    setActiveNodeIds([]);
    setActiveEdgeIds([]);
    activeLaneNodeIdsRef.current.clear();
    engineRef.current.stopAll();
  }, []);

  const previewSample = useCallback((sampleId: NumberedSampleId) => {
    void engineRef.current.start().then(() => {
      engineRef.current.playSample(sampleId);
    });
  }, []);

  const onDragStart = useCallback((event: React.DragEvent<HTMLButtonElement>, sampleId: SampleId) => {
    event.dataTransfer.setData("application/x-markov-sample", JSON.stringify({ sampleId }));
    event.dataTransfer.effectAllowed = "move";
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!flowWrapperRef.current) {
        return;
      }

      const payload = event.dataTransfer.getData("application/x-markov-sample");

      if (!payload) {
        return;
      }

      const parsedPayload = JSON.parse(payload) as { sampleId?: SampleId };
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      });

      addNodeAt(position, parsedPayload.sampleId ?? null);
    },
    [addNodeAt, screenToFlowPosition]
  );

  const onCanvasWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (selectedEdgeIds.length !== 1 || selectedNodeIds.length > 0) {
        return;
      }

      const selectedEdgeId = selectedEdgeIds[0];
      const edge = edges.find((candidate) => candidate.id === selectedEdgeId);

      if (!edge || !isTransitionEdge(edge)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const scrollDirection = event.deltaY < 0 ? 1 : -1;
      const step = event.shiftKey ? 0.05 : 0.01;
      const nextProbability = clampProbability((edge.data?.probability ?? 0) + scrollDirection * step);

      setEdges((previousEdges) => setEdgeProbability(previousEdges, selectedEdgeId, nextProbability));
    },
    [edges, selectedEdgeIds, selectedNodeIds.length]
  );

  const selectedEdgeProbability = selectedEdge?.data?.probability ?? 0;
  const selectedEdgeIsClock = selectedEdge ? isClockEdge(selectedEdge) : false;
  const selectedEdgeClockLabel = selectedEdge?.data?.clockDivision
    ? clockDivisionLabels[selectedEdge.data.clockDivision]
    : selectedEdge?.sourceHandle === SWING_PORTS.OUTPUT
      ? "Swing"
      : "-";
  const canDelete =
    selectedNodeIds.some((nodeId) => nodeId !== MASTER_CLOCK_NODE_ID) || selectedEdgeIds.length > 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">MC</div>
          <div>
            <h1>Probabilistic Sample Player</h1>
            <p>{isPlaying ? "Playing" : "Stopped"}</p>
          </div>
        </div>

        <div className="transport">
          <button
            className="transport-button play"
            type="button"
            onClick={startPlayback}
            disabled={isPlaying || validClockLanes.length === 0}
            title="Play"
          >
            <Play size={18} aria-hidden="true" />
            <span>Play</span>
          </button>
          <button
            className="transport-button stop"
            type="button"
            onClick={stopPlayback}
            disabled={!isPlaying}
            title="Stop"
          >
            <Square size={16} aria-hidden="true" />
            <span>Stop</span>
          </button>
          <label className="bpm-control">
            <span>BPM</span>
            <input
              type="range"
              min={MIN_BPM}
              max={MAX_BPM}
              value={bpm}
              onChange={(event) => setBpm(clampBpm(Number(event.target.value)))}
            />
            <input
              className="bpm-number"
              type="number"
              min={MIN_BPM}
              max={MAX_BPM}
              value={bpm}
              onChange={(event) => setBpm(clampBpm(Number(event.target.value)))}
            />
          </label>
        </div>

        <div className="toolbar">
          <button type="button" onClick={addNode} disabled={editableNodes.length >= MAX_NODES} title="Add node">
            <Plus size={17} aria-hidden="true" />
            <span>Add</span>
          </button>
          <button
            type="button"
            onClick={addSwingNode}
            disabled={editableNodes.length >= MAX_NODES}
            title="Add swing node"
          >
            <Shuffle size={17} aria-hidden="true" />
            <span>Swing</span>
          </button>
          <button type="button" onClick={deleteSelected} disabled={!canDelete} title="Delete selected">
            <Trash2 size={17} aria-hidden="true" />
            <span>Delete</span>
          </button>
          <button type="button" onClick={clearGraph} disabled={editableNodes.length === 0} title="Clear graph">
            <RotateCcw size={17} aria-hidden="true" />
            <span>Clear</span>
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="palette-panel" aria-label="Sample palette">
          <div className="panel-heading">
            <Volume2 size={17} aria-hidden="true" />
            <span>Samples</span>
          </div>
          <div className="sample-list">
            <button
              className="sample-tile silent"
              draggable={editableNodes.length < MAX_NODES}
              onDragStart={(event) => onDragStart(event, null)}
              type="button"
              disabled={editableNodes.length >= MAX_NODES}
              title="Drag silent node"
            >
              <span className="sample-swatch" />
              <span>Silent</span>
            </button>
            {SAMPLE_IDS.map((sampleId) => (
              <button
                key={sampleId}
                className={`sample-tile sample-${sampleId}`}
                draggable={editableNodes.length < MAX_NODES}
                onClick={() => previewSample(sampleId)}
                onDragStart={(event) => onDragStart(event, sampleId)}
                type="button"
                disabled={editableNodes.length >= MAX_NODES}
                title={`Preview or drag ${sampleNames[sampleId]}`}
              >
                <span className="sample-swatch" />
                <span>{sampleNames[sampleId]}</span>
              </button>
            ))}
          </div>
          <div className="node-counter">
            <MousePointer2 size={15} aria-hidden="true" />
            <span>
              {editableNodes.length}/{MAX_NODES}
            </span>
          </div>
        </aside>

        <div
          className="flow-frame"
          ref={flowWrapperRef}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onWheelCapture={onCanvasWheel}
        >
          <ReactFlow<AppNode, AppEdge>
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onSelectionChange={onSelectionChange}
            isValidConnection={isDisciplinedConnection}
            connectionMode={ConnectionMode.Strict}
            nodesDraggable
            nodesConnectable
            edgesReconnectable
            elementsSelectable
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
          >
            <Background color="#c9c3bb" gap={28} size={1.4} variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                activeNodeIdSet.has(node.id)
                  ? "#f97316"
                  : node.id === MASTER_CLOCK_NODE_ID
                    ? "#0f9f86"
                    : node.type === "swingNode"
                      ? "#8b3fd1"
                      : "#71685f"
              }
            />
          </ReactFlow>
        </div>

        <aside className="inspector-panel" aria-label="Inspector">
          <div className="panel-heading">
            <Link2 size={17} aria-hidden="true" />
            <span>Inspector</span>
          </div>

          {selectedNode?.id === MASTER_CLOCK_NODE_ID ? (
            <div className="inspector-stack">
              <label className="field">
                <span>BPM</span>
                <input
                  type="number"
                  min={MIN_BPM}
                  max={MAX_BPM}
                  value={bpm}
                  onChange={(event) => setBpm(clampBpm(Number(event.target.value)))}
                />
              </label>
              <div className="patch-stats">
                <div>
                  <span>Routes</span>
                  <strong>{validClockLanes.length}</strong>
                </div>
                <div>
                  <span>Active</span>
                  <strong>{activeClockOutputLabels || "-"}</strong>
                </div>
                <div>
                  <span>Outputs</span>
                  <strong>4</strong>
                </div>
              </div>
            </div>
          ) : selectedNode?.type === "swingNode" ? (
            <div className="inspector-stack">
              <label className="field">
                <span>Label</span>
                <input
                  type="text"
                  value={selectedNode.data.label}
                  onChange={(event) => updateSelectedNodeData({ label: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Amount</span>
                <input
                  type="range"
                  min={50}
                  max={75}
                  value={Math.round(clampSwingAmount(selectedNode.data.swingAmount) * 100)}
                  onChange={(event) =>
                    updateSelectedNodeData({
                      swingAmount: Number(event.target.value) / 100
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Chance</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(clampSwingChance(selectedNode.data.swingChance) * 100)}
                  onChange={(event) =>
                    updateSelectedNodeData({
                      swingChance: Number(event.target.value) / 100
                    })
                  }
                />
              </label>
              <div className="patch-stats">
                <div>
                  <span>Amount</span>
                  <strong>{Math.round(clampSwingAmount(selectedNode.data.swingAmount) * 100)}%</strong>
                </div>
                <div>
                  <span>Chance</span>
                  <strong>{Math.round(clampSwingChance(selectedNode.data.swingChance) * 100)}%</strong>
                </div>
              </div>
            </div>
          ) : selectedNode?.type === "markovNode" ? (
            <div className="inspector-stack">
              <label className="field">
                <span>Label</span>
                <input
                  type="text"
                  value={selectedNode.data.label}
                  onChange={(event) => updateSelectedNodeData({ label: event.target.value })}
                />
              </label>

              <label className="field">
                <span>Sample</span>
                <select
                  value={selectedNode.data.sampleId ?? "none"}
                  onChange={(event) =>
                    updateSelectedNodeData({
                      sampleId:
                        event.target.value === "none"
                          ? null
                          : (Number(event.target.value) as NumberedSampleId)
                    })
                  }
                >
                  <option value="none">Silent</option>
                  {SAMPLE_IDS.map((sampleId) => (
                    <option key={sampleId} value={sampleId}>
                      {sampleNames[sampleId]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="edge-editor">
                <div className="subheading">Outgoing</div>
                {selectedNodeOutgoingEdges.length === 0 ? (
                  <div className="empty-state">Self 100%</div>
                ) : (
                  selectedNodeOutgoingEdges.map((edge) => {
                    const target = nodes.find((node) => node.id === edge.target);
                    const probability = edge.data?.probability ?? 0;

                    return (
                      <label className="probability-row" key={edge.id}>
                        <span className="edge-target">
                          {edge.source === edge.target ? "Self" : target?.data.label ?? edge.target}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(probability * 100)}
                          onChange={(event) => setProbability(edge.id, Number(event.target.value) / 100)}
                        />
                        <input
                          className="probability-number"
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(probability * 100)}
                          onChange={(event) => setProbability(edge.id, Number(event.target.value) / 100)}
                        />
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          ) : selectedEdge ? (
            <div className="inspector-stack">
              <div className="edge-summary">
                <span>{selectedSourceNode?.data.label ?? selectedEdge.source}</span>
                <span>to</span>
                <span>{selectedTargetNode?.data.label ?? selectedEdge.target}</span>
              </div>
              {selectedEdgeIsClock ? (
                <div className="patch-stats">
                  <div>
                    <span>Clock</span>
                    <strong>{selectedEdgeClockLabel}</strong>
                  </div>
                </div>
              ) : (
                <label className="probability-row single">
                  <span>{probabilityPercent(selectedEdgeProbability)}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(selectedEdgeProbability * 100)}
                    onChange={(event) => setProbability(selectedEdge.id, Number(event.target.value) / 100)}
                  />
                  <input
                    className="probability-number"
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(selectedEdgeProbability * 100)}
                    onChange={(event) => setProbability(selectedEdge.id, Number(event.target.value) / 100)}
                  />
                </label>
              )}
            </div>
          ) : (
            <div className="patch-stats">
              <div>
                <span>Nodes</span>
                <strong>{editableNodes.length}</strong>
              </div>
              <div>
                <span>Edges</span>
                <strong>{edges.length}</strong>
              </div>
              <div>
                <span>Routes</span>
                <strong>{validClockLanes.length}</strong>
              </div>
              <div>
                <span>Active</span>
                <strong>{activeClockOutputLabels || "-"}</strong>
              </div>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

export default App;
