/**
 * 浮窗链接组（N 窗联动播放）纯逻辑。
 *
 * 规则（用户拍板）：
 * - 每个浮窗标题栏有链接开关，点开即加入链接组；第一个加入者无变化（成为基准窗），
 *   第二个及以后加入的直接对齐到基准窗当前进度
 * - 组内任意窗的 播放/暂停、相对快进快退（含双击/滚轮/进度条 seek）中继到其余各窗
 * - 点关闭解除本窗链接（组收缩），其余窗保持联动；组空即散
 *
 * 形态（App syncState）：{ ids: [winId...]（按加入顺序，ids[0]=基准窗）, seekSeq,
 * seekCmds: {winId: {seq, from, to, mode, reason?}}, playSeq, playCmds: {winId: {seq, paused}} }
 * 组件端按 seq 去重接收；窗间互不知晓，全走 App 中继。
 */

export function createLinkGroup() {
  return { ids: [], seekSeq: 0, seekCmds: {}, playSeq: 0, playCmds: {} };
}

/**
 * 窗加入/退出链接组。anchorPos = 基准窗（ids[0]）最近上报的播放位置（秒）；
 * 组非空且可读时，新窗收到一条 absolute seek（reason='join'）直接对齐基准进度。
 */
export function toggleLinkMembership(state, winId, anchorPos = null) {
  const base = state || createLinkGroup();
  if (base.ids.includes(winId)) {
    // 退出：本窗摘除，组空即散
    const ids = base.ids.filter(x => x !== winId);
    if (ids.length === 0) return null;
    return { ...base, ids };
  }
  const ids = [...base.ids, winId];
  const next = { ...base, ids };
  if (base.ids.length > 0 && Number.isFinite(anchorPos)) {
    const seq = base.seekSeq + 1;
    next.seekSeq = seq;
    next.seekCmds = { ...base.seekCmds, [winId]: { seq, from: 0, to: anchorPos, mode: 'absolute', reason: 'join' } };
  }
  return next;
}

/**
 * 相对 seek 中继：来源窗以外的每个成员各得一条命令（各自按本窗当前位置平移 delta）。
 */
export function relayRelativeSeek(state, fromWinId, fromTime, toTime) {
  if (!state?.ids.includes(fromWinId)) return state;
  const seq = state.seekSeq + 1;
  const seekCmds = { ...state.seekCmds };
  for (const id of state.ids) {
    if (id !== fromWinId) seekCmds[id] = { seq, from: fromTime, to: toTime, mode: 'relative' };
  }
  return { ...state, seekSeq: seq, seekCmds };
}

/**
 * 播放/暂停中继：来源窗以外的每个成员各得一条命令（共享同一 seq，组件端各自去重）。
 */
export function relayPlayPause(state, fromWinId, paused) {
  if (!state?.ids.includes(fromWinId)) return state;
  const seq = state.playSeq + 1;
  const playCmds = { ...state.playCmds };
  for (const id of state.ids) {
    if (id !== fromWinId) playCmds[id] = { seq, paused };
  }
  return { ...state, playSeq: seq, playCmds };
}
