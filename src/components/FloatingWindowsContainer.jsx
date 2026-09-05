import FloatingVideoWindow from './FloatingVideoWindow';

export default function FloatingWindowsContainer({
  windows = [],
  frontWindowId = null,
  onCloseWindow,
  onSkipWindow,
  onExpandWindow,
  onBringToFront,
  onUpdateItem,
  onDeleteItem,
  onSwitchItem
}) {
  if (!windows || windows.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-40 overflow-visible">
      {windows.map(win => (
        <div key={win.id} className="pointer-events-auto">
          <FloatingVideoWindow
            windowData={win}
            isFront={win.id === frontWindowId}
            onClose={onCloseWindow}
            onSkip={onSkipWindow}
            onExpand={onExpandWindow}
            onBringToFront={onBringToFront}
            onUpdateItem={onUpdateItem}
            onDeleteItem={onDeleteItem}
            onSwitchItem={onSwitchItem}
          />
        </div>
      ))}
    </div>
  );
}
