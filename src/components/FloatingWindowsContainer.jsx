import FloatingVideoWindow from './FloatingVideoWindow';

export default function FloatingWindowsContainer({
  windows = [],
  onCloseWindow,
  onSkipWindow,
  onExpandWindow,
  onBringToFront,
  onUpdateItem,
  onDeleteItem
}) {
  if (!windows || windows.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-40 overflow-visible">
      {windows.map(win => (
        <div key={win.id} className="pointer-events-auto">
          <FloatingVideoWindow
            windowData={win}
            onClose={onCloseWindow}
            onSkip={onSkipWindow}
            onExpand={onExpandWindow}
            onBringToFront={onBringToFront}
            onUpdateItem={onUpdateItem}
            onDeleteItem={onDeleteItem}
          />
        </div>
      ))}
    </div>
  );
}
