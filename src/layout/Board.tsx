import { useMemo } from "react";
import { GridLayout, getCompactor, useContainerWidth, verticalCompactor } from "react-grid-layout";
import { createScaledStrategy } from "react-grid-layout/core";
import { usePitwall } from "../data/store";
import { cn } from "../lib/format";
import { DRAWER_BAR_PX, Drawer } from "../drawer/Drawer";
import { WIDGETS, type WidgetId } from "../widgets/registry";
import { useSize } from "../ui/hooks";
import { currentScale } from "../ui/scale";
import { GRID, GRID_MARGIN, TELEMETRY_CARD_ROWS, telemetryRowsFor, towerRowsFor } from "./defaults";
import { fitToRows } from "./fit";
import { useLayout } from "./layoutStore";

// Free mode: no compaction, no overlap, and a drop onto another widget is refused
// rather than shoving it aside
const freeCompactor = getCompactor(null, false, true);
const PADDING = 6;
const FIXED_HEIGHT = new Set(["telemetry"]);

export function Board() {
  const { view, items, locked, packing, setItems, remove } = useLayout();
  const drivers = usePitwall((s) => Object.keys(s.live.DriverList ?? {}).length);
  const selectedCount = usePitwall((s) => s.selected.length);
  const { width, containerRef, mounted } = useContainerWidth();
  const [boardRef, board] = useSize<HTMLDivElement>();
  const { cols, rowHeight } = GRID[view];
  const isWindow = view === "window";
  // Window: the grid gets exactly the rows that fit above the drawer bar, so the page
  // never scrolls. The side panel is one long column and scrolls as usual.
  const rows = isWindow ? Math.max(8, Math.floor((board.height - 2 * PADDING - DRAWER_BAR_PX + GRID_MARGIN) / (rowHeight + GRID_MARGIN))) : 0;
  const colWidth = (width - 2 * PADDING - (cols - 1) * GRID_MARGIN) / cols;
  const spanPx = (w: number) => w * colWidth + (w - 1) * GRID_MARGIN;

  // Content-sized widgets: the tower can't grow past its last driver row, and telemetry
  // is one row of cards tall (in the window, cards beyond two open out to the left)
  const layout = useMemo(() => {
    const towerMax = towerRowsFor(drivers || 22);
    const sized = items.map((it) => {
      if (it.i === "tower") return { ...it, h: Math.min(it.h, towerMax), maxH: towerMax };
      if (it.i === "telemetry") {
        const h = isWindow ? TELEMETRY_CARD_ROWS : telemetryRowsFor(spanPx(it.w) - 2, Math.max(1, selectedCount));
        return { ...it, h, minH: h, maxH: h, resizeHandles: ["e" as const] };
      }
      return it;
    });
    return isWindow && board.height > 0 ? fitToRows(sized, rows, FIXED_HEIGHT) : sized;
  }, [items, drivers, selectedCount, colWidth, isWindow, rows, board.height]); // spanPx only depends on colWidth

  // The drawer sits under the timing tower's column (full width without a tower)
  const tower = isWindow ? layout.find((it) => it.i === "tower") : undefined;
  const drawerLeft = tower ? PADDING + tower.x * (colWidth + GRID_MARGIN) : PADDING;
  const drawerWidth = tower ? spanPx(tower.w) : Math.max(0, width - 2 * PADDING);

  return (
    <div ref={boardRef} className="relative min-h-0 flex-1">
      <div ref={containerRef} className={cn("absolute inset-0 overflow-x-hidden", isWindow ? "overflow-y-hidden" : "overflow-y-auto")}>
        {mounted && width > 0 && (
          <GridLayout
            width={width}
            layout={layout}
            gridConfig={{
              cols,
              rowHeight,
              margin: [GRID_MARGIN, GRID_MARGIN],
              containerPadding: [PADDING, PADDING],
              maxRows: isWindow ? rows : Infinity,
            }}
            dragConfig={{ enabled: !locked, handle: ".widget-handle", cancel: ".widget-no-drag" }}
            resizeConfig={{ enabled: !locked, handles: ["se", "e", "s"] }}
            compactor={packing === "free" ? freeCompactor : verticalCompactor}
            // Pointer deltas are screen pixels; the grid lives in the zoomed UI (ui/scale.ts)
            positionStrategy={createScaledStrategy(currentScale())}
            // Save only what the user did: the render-time fit must not overwrite it
            onDragStop={(l) => setItems(l)}
            onResizeStop={(l) => setItems(l)}
          >
            {layout.map((item) => {
              const id = item.i as WidgetId;
              const def = WIDGETS[id];
              const Body = def.component;
              return (
                <div
                  key={id}
                  className={cn(
                    "relative rounded-lg border border-zinc-800 bg-background",
                    // Telemetry cards beyond two open out over the widgets to the left
                    id === "telemetry" && isWindow ? "z-20 overflow-visible" : "overflow-hidden"
                  )}
                >
                  <div className="widget-no-drag h-full">
                    <Body />
                  </div>
                  {/* Title bar stays hidden; hovering the top edge slides it down (styles.css) */}
                  <div className="widget-hotzone absolute inset-x-0 top-0 z-20 h-3" />
                  <div className="widget-handle widget-header absolute inset-x-0 top-0 z-30 flex h-8 cursor-grab items-center gap-2 border-b border-zinc-700 bg-zinc-900/95 px-3 shadow-lg shadow-black/40 backdrop-blur active:cursor-grabbing">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-300">{def.title}</span>
                    {!locked && <span className="text-[10px] text-zinc-500">drag to move</span>}
                    {!locked && (
                      <button
                        className="widget-no-drag ml-auto flex h-6 w-6 items-center justify-center rounded text-base text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        data-tip={`Remove ${def.title}`}
                        onClick={() => remove(id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </GridLayout>
        )}
        {/* Room to scroll the grid clear of the drawer bar */}
        <div style={{ height: DRAWER_BAR_PX }} />
      </div>
      {mounted && width > 0 && <Drawer left={drawerLeft} width={drawerWidth} />}
    </div>
  );
}
