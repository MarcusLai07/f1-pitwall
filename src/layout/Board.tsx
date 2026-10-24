import { GridLayout, getCompactor, useContainerWidth, verticalCompactor } from "react-grid-layout";
import { WIDGETS, type WidgetId } from "../widgets/registry";
import { GRID } from "./defaults";
import { useLayout } from "./layoutStore";

// Free mode: no compaction, no overlap, and a drop onto another widget is refused
// rather than shoving it aside
const freeCompactor = getCompactor(null, false, true);

export function Board() {
  const { view, items, locked, packing, setItems, remove } = useLayout();
  const { width, containerRef, mounted } = useContainerWidth();
  const { cols, rowHeight } = GRID[view];

  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={items}
          gridConfig={{ cols, rowHeight, margin: [6, 6], containerPadding: [6, 6] }}
          dragConfig={{ enabled: !locked, handle: ".widget-handle", cancel: ".widget-no-drag" }}
          resizeConfig={{ enabled: !locked, handles: ["se", "e", "s"] }}
          compactor={packing === "free" ? freeCompactor : verticalCompactor}
          onLayoutChange={setItems}
        >
          {items.map((item) => {
            const id = item.i as WidgetId;
            const def = WIDGETS[id];
            const Body = def.component;
            return (
              <div key={id} className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-background">
                <div className="widget-handle flex h-7 shrink-0 cursor-grab items-center gap-2 border-b border-zinc-800 bg-zinc-900/70 px-2.5 active:cursor-grabbing">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{def.title}</span>
                  {!locked && (
                    <button
                      className="widget-no-drag ml-auto flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      title={`Remove ${def.title}`}
                      onClick={() => remove(id)}
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="widget-no-drag min-h-0 flex-1">
                  <Body />
                </div>
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
