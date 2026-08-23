/**
 * VR Video Detector & Projection Mode Resolver
 * Automatically identifies if a media item is a VR video vs standard 2D or 3D-to-2D
 */

export function detectVrVideo(item, videoElement = null) {
  if (!item) return { isVr: false, mode: '180_3d_sbs', confidence: 0 };

  const name = item.Name || '';
  const path = item.Path || '';
  const originalTitle = item.OriginalTitle || '';
  const overview = item.Overview || '';
  const tags = (item.Tags || []).map(t => String(t).toLowerCase());
  const genres = (item.Genres || []).map(g => String(g).toLowerCase());
  const combinedText = `${name} ${path} ${originalTitle} ${overview}`.toLowerCase();

  // 1. Tag & Genre Explicit VR Check
  const hasVrTag = tags.some(t => ['vr', 'vr180', 'vr360', 'virtual reality', 'vr video', 'fisheye'].includes(t)) ||
                   genres.some(g => ['vr', 'vr180', 'vr360', 'virtual reality'].includes(g));

  // 2. High-precision VR Keywords in Filename, Path, or Title
  // e.g. "VR", "VR180", "180_SBS", "360_SBS", "180TB", "360TB", "180LR", "360LR", "Fisheye180", "VRG", "[VR]", "(VR)", "-VR.", "_VR."
  const isExplicitVrKeyword = 
    /(?:^|[^a-z0-9])(vr180|vr360|180_?sbs|360_?sbs|180_?tb|360_?tb|180_?lr|360_?lr|fisheye180|fisheye|vr-?video|vrg)(?:[^a-z0-9]|$)/i.test(combinedText) ||
    /[-_\[(]vr[-_\]\.\s]/i.test(name) ||
    /[-_\[(]vr[-_\]\.\s]/i.test(path) ||
    /[/\\]vr[/\\]/i.test(path) ||
    /[/\\]vr/i.test(path);

  // 3. Resolution / Aspect Ratio Check from MediaStreams or Video Element
  const videoStream = item.MediaStreams?.find(s => s.Type === 'Video') || item.MediaSources?.[0]?.MediaStreams?.find(s => s.Type === 'Video');
  const width = videoElement?.videoWidth || videoStream?.Width || 0;
  const height = videoElement?.videoHeight || videoStream?.Height || 0;
  
  let isVrDimension = false;
  if (width > 0 && height > 0) {
    const ratio = width / height;
    // 1:1 Aspect Ratio (e.g. 2880x2880, 3840x3840, 1920x1920, 4096x4096) is classic 180° SBS / VR180
    // 2:1 Aspect Ratio (e.g. 5760x2880, 7680x3840, 8192x4096) with high resolution >= 3840
    if (Math.abs(ratio - 1.0) < 0.08 && width >= 1920) {
      isVrDimension = true;
    } else if (Math.abs(ratio - 2.0) < 0.08 && width >= 4000) {
      isVrDimension = true;
    }
  }

  const isVr = hasVrTag || isExplicitVrKeyword || (isVrDimension && isExplicitVrKeyword);

  if (!isVr) {
    return { isVr: false, mode: '180_3d_sbs', confidence: 0 };
  }

  // Determine VR Mode:
  // 180 vs 360, SBS vs TB vs 2D
  let mode = '180_3d_sbs'; // Default modern VR format

  if (/360_?tb|360_?ou|top_bottom|topbottom/i.test(combinedText)) {
    mode = '360_3d_tb';
  } else if (/360_?sbs|360_?lr|360_?3d/i.test(combinedText)) {
    mode = '360_3d_sbs';
  } else if (/360|equirectangular/i.test(combinedText)) {
    mode = '360_2d';
  } else if (/180_?2d|dome|hemisphere/i.test(combinedText)) {
    mode = '180_2d';
  } else if (/180|fisheye|sbs|lr/i.test(combinedText) || Math.abs((width / (height || 1)) - 1.0) < 0.08) {
    mode = '180_3d_sbs';
  }

  return { isVr: true, mode, confidence: hasVrTag || isExplicitVrKeyword ? 1 : 0.8 };
}
