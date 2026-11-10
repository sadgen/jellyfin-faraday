import FloatingVideoWindow from './FloatingVideoWindow';

export default function FloatingWindowsContainer({
  windows = [],
  frontWindowId = null,
  onCloseWindow,
  onSkipWindow,
  onExpandWindow,
  onMaximizeWindow,
  onExclusiveWindow,
  onCropChangeWindow,
  onBringToFront,
  onUpdateItem,
  onDeleteItem,
  onSwitchItem,
  onPlayingChange,
  // 双窗联动（迷你窗容器不传，全部缺省关闭）
  syncedIds = null,
  syncSeekCommands = null,
  syncPlayCommands = null,
  onSyncSeek,
  onSyncPlay,
  onSyncToggle,
  onSyncAlign
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
            onMaximize={onMaximizeWindow}
            onExclusiveCrop={onExclusiveWindow}
            onCropChange={onCropChangeWindow}
            onBringToFront={onBringToFront}
            onUpdateItem={onUpdateItem}
            onDeleteItem={onDeleteItem}
            onSwitchItem={onSwitchItem}
            onPlayingChange={onPlayingChange}
            isSynced={!!syncedIds?.includes(win.id)}
            syncSeekCommand={syncSeekCommands?.[win.id] || null}
            syncPlayCommand={syncPlayCommands?.[win.id] || null}
            onSyncSeek={onSyncSeek}
            onSyncPlay={onSyncPlay}
            onSyncToggle={onSyncToggle}
            onSyncAlign={onSyncAlign}
          />
        </div>
      ))}
    </div>
  );
}
