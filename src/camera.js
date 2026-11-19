/** Front-camera frame source (browser only). */
export function createCameraSource() {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null, lastTime = -1;

  return {
    video,
    get stream() { return stream; },
    async start() {
      if (stream) return;
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320, max: 640 }, height: { ideal: 240, max: 480 } },
        audio: false,
      });
      // A track that ends (another app took the camera) reads as no frames → engine 'stalled'.
      stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { stream = null; }));
      video.srcObject = stream;
      lastTime = -1;
      await video.play();
    },
    stop() {
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null; video.srcObject = null;
    },
    readFrame() {
      if (!stream || video.readyState < 2 || !video.videoWidth) return null;
      // A frozen video (call, Control Center) keeps the same time: report no new frame.
      if (video.currentTime === lastTime) return null;
      lastTime = video.currentTime;
      const scale = Math.min(1, 320 / video.videoWidth);
      const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      return { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
    },
    /** Freeze exposure / white balance / focus where the browser allows it (SRS FR-8). */
    async lock() {
      const track = stream && stream.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : {};
      const cur = track && track.getSettings ? track.getSettings() : {};
      const keep = { exposureMode: 'exposureTime', whiteBalanceMode: 'colorTemperature', focusMode: 'focusDistance' };
      const advanced = [];
      for (const k of Object.keys(keep)) {
        if (!Array.isArray(caps[k]) || !caps[k].includes('manual')) continue;
        // Freeze at the current value instead of jumping to a default (FR-8).
        const c = { [k]: 'manual' };
        if (cur[keep[k]] !== undefined) c[keep[k]] = cur[keep[k]];
        advanced.push(c);
      }
      if (!advanced.length) return { locked: false };
      try { await track.applyConstraints({ advanced }); return { locked: true }; }
      catch { return { locked: false }; }
    },
  };
}
