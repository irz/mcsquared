import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Shuffle } from "lucide-react";
import { SWING_PORTS, type AppNode } from "../types";
import { clampSwingAmount, clampSwingChance } from "../lib/swing";

export function SwingNode({ data, selected }: NodeProps<AppNode>) {
  const amount = clampSwingAmount(data.swingAmount);
  const chance = clampSwingChance(data.swingChance);
  const meterWidth = ((amount - 0.5) / 0.25) * 100;

  return (
    <div className={selected ? "swing-node is-selected" : "swing-node"}>
      <Handle
        id={SWING_PORTS.INPUT}
        type="target"
        position={Position.Left}
        className="node-handle swing-node__handle swing-node__handle--input"
      />
      <div className="swing-node__header">
        <Shuffle size={17} aria-hidden="true" />
        <span>{data.label}</span>
      </div>
      <div className="swing-node__amount">
        <strong>{Math.round(amount * 100)}%</strong>
        <span>{Math.round(chance * 100)}% chance</span>
      </div>
      <div className="swing-node__meter" aria-hidden="true">
        <span style={{ width: `${meterWidth}%` }} />
      </div>
      <Handle
        id={SWING_PORTS.OUTPUT}
        type="source"
        position={Position.Right}
        className="node-handle swing-node__handle swing-node__handle--output"
      />
    </div>
  );
}
