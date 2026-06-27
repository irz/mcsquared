import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Volume2 } from "lucide-react";
import { NODE_PORTS, type AppNode } from "../types";

export function MarkovNode({ data, selected }: NodeProps<AppNode>) {
  const sampleLabel = data.sampleId ? `S${data.sampleId}` : "Silent";

  return (
    <div
      className={[
        "markov-node",
        selected ? "is-selected" : "",
        data.isActive ? "is-active" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle
        id={NODE_PORTS.SELF_SOURCE}
        type="source"
        position={Position.Top}
        className="node-handle node-handle--self node-handle--self-source"
      />
      <Handle
        id={NODE_PORTS.SELF_TARGET}
        type="target"
        position={Position.Top}
        className="node-handle node-handle--self node-handle--self-target"
      />
      <Handle
        id={NODE_PORTS.INPUT}
        type="target"
        position={Position.Left}
        className="node-handle node-handle--input"
      />
      <div className="markov-node__topline">
        <span className="markov-node__label">{data.label}</span>
      </div>
      <div className="markov-node__sample">
        <Volume2 size={14} aria-hidden="true" />
        <span>{sampleLabel}</span>
      </div>
      <Handle
        id={NODE_PORTS.OUTPUT}
        type="source"
        position={Position.Right}
        className="node-handle node-handle--output"
      />
    </div>
  );
}
