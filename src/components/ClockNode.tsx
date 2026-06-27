import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock3 } from "lucide-react";
import { CLOCK_PORTS, type AppNode } from "../types";

const outputs = [
  { id: CLOCK_PORTS.WHOLE, label: "Whole", top: "24%" },
  { id: CLOCK_PORTS.QUARTER, label: "Quarter", top: "43%" },
  { id: CLOCK_PORTS.EIGHTH, label: "Eighth", top: "62%" },
  { id: CLOCK_PORTS.SIXTEENTH, label: "Sixteenth", top: "81%" }
];

export function ClockNode({ data, selected }: NodeProps<AppNode>) {
  return (
    <div className={selected ? "clock-node is-selected" : "clock-node"}>
      <div className="clock-node__header">
        <Clock3 size={17} aria-hidden="true" />
        <span>{data.label}</span>
      </div>
      <div className="clock-node__bpm">
        <strong>{data.bpm ?? 120}</strong>
        <span>BPM</span>
      </div>
      <div className="clock-node__outputs">
        {outputs.map((output) => (
          <div className="clock-node__output" key={output.id}>
            <span>{output.label}</span>
            <Handle
              id={output.id}
              type="source"
              position={Position.Right}
              className="node-handle clock-node__handle"
              style={{ top: output.top }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
