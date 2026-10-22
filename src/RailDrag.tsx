import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { HTMLAttributes, ReactNode } from "react";
import type { Slide } from "./model";

export type RailDragSource =
  { kind: "row"; y: number } | { kind: "page"; id: string };
export type RailDropTarget = {
  kind: "row" | "cell" | "insert" | "row-insert";
  x: number;
  y: number;
};
interface RowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  y: number;
  x: number;
  hasPages: boolean;
  shifted?: boolean;
  children: (props: HTMLAttributes<HTMLButtonElement>) => ReactNode;
}
export function RailRowFrame({
  y,
  x,
  hasPages,
  shifted,
  children,
  ...props
}: RowProps) {
  const drag = useDraggable({
    id: `row-${y}`,
    data: { kind: "row", y } satisfies RailDragSource,
    disabled: !hasPages,
  });
  const drop = useDroppable({
    id: `row-target-${y}`,
    data: { kind: "row", x, y } satisfies RailDropTarget,
  });
  return (
    <div
      {...props}
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      data-drop-row={y}
      data-insert-shift={!!shifted}
      className={`rail-entry ${drop.isOver ? "rail-drop-over" : ""} ${drag.isDragging ? "rail-dragging" : ""}`}
    >
      {children(hasPages ? { ...drag.attributes, ...drag.listeners } : {})}
    </div>
  );
}
export function PageDragFrame({
  x,
  y,
  page,
  shifted,
  children,
}: {
  x: number;
  y: number;
  page?: Slide;
  shifted?: boolean;
  children: (
    props: HTMLAttributes<HTMLButtonElement>,
    ref: (node: HTMLButtonElement | null) => void,
  ) => ReactNode;
}) {
  const drag = useDraggable({
    id: `page-${page?.id ?? `${x}-${y}`}`,
    data: { kind: "page", id: page?.id ?? "" } satisfies RailDragSource,
    disabled: !page,
  });
  const drop = useDroppable({
    id: `cell-${x}-${y}`,
    data: { kind: "cell", x, y } satisfies RailDropTarget,
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={`row-page-pair ${drop.isOver ? "rail-drop-over" : ""} ${drag.isDragging ? "rail-dragging" : ""}`}
      data-drop-cell={`${x},${y}`}
      data-insert-shift={!!shifted}
    >
      {children(
        page ? { ...drag.attributes, ...drag.listeners } : {},
        drag.setNodeRef,
      )}
    </div>
  );
}
export function PageInsertDrop({
  x,
  y,
  children,
  active,
}: {
  x: number;
  y: number;
  children?: ReactNode;
  active: boolean;
}) {
  const drop = useDroppable({
    id: `insert-${x}-${y}`,
    data: { kind: "insert", x, y } satisfies RailDropTarget,
    disabled: !active,
  });
  return (
    <div
      ref={drop.setNodeRef}
      data-drop-insert={`${x},${y}`}
      data-leading={x === 0}
      data-active={active}
      data-over={drop.isOver}
      className="page-insert-drop"
    >
      {children}
      <span className="insert-drop-line" aria-hidden="true" />
      {drop.isOver && <span className="insert-drop-label">ここに挿入</span>}
    </div>
  );
}
export function RowInsertDrop({
  y,
  active,
  children,
}: {
  y: number;
  active: boolean;
  children?: ReactNode;
}) {
  const drop = useDroppable({
    id: `row-insert-${y}`,
    data: { kind: "row-insert", x: 0, y } satisfies RailDropTarget,
    disabled: !active,
  });
  return (
    <div
      ref={drop.setNodeRef}
      className="row-insert-drop"
      data-drop-row-insert={y}
      data-leading={y === 0}
      data-active={active}
      data-over={drop.isOver}
    >
      {children}
      <span className="insert-drop-line" aria-hidden="true" />
      {drop.isOver && <span className="insert-drop-label">ここに段を挿入</span>}
    </div>
  );
}
export function NewRowDrop({
  x,
  y,
  group = false,
}: {
  x: number;
  y: number;
  group?: boolean;
}) {
  const drop = useDroppable({
    id: "new-row-target",
    data: { kind: group ? "row-insert" : "row", x, y } satisfies RailDropTarget,
    disabled: !group && y >= 100,
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={`rail-new-row-drop ${drop.isOver ? "rail-drop-over" : ""}`}
      data-drop-row={y}
    >
      ここにドロップで
      <br />
      {group ? "最後の段へ" : "新しい段へ"}
    </div>
  );
}
