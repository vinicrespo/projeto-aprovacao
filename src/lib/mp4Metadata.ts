/**
 * Strips identifying metadata from an MP4 ArrayBuffer produced by mp4-muxer.
 *
 * Removes:
 *  - creation_time / modification_time in mvhd, tkhd, mdhd
 *    (these embed the exact wall-clock date/time the file was made)
 *  - the handler name string in hdlr boxes
 *    (mp4-muxer writes "mp4-muxer-hdlr", which reveals the tool used)
 *
 * The MP4 is re-encoded from raw frames, so no source-video EXIF/GPS/device
 * metadata is ever inherited — this pass zeroes the only fields the muxer
 * itself introduces. Operates in place and returns the same buffer.
 */
export function cleanMp4Metadata(buffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  const tag = (off: number) =>
    String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);

  const CONTAINERS = new Set(["moov", "trak", "mdia", "edts", "udta", "minf", "stbl"]);
  const TIME_BOXES = new Set(["mvhd", "tkhd", "mdhd"]);

  const walk = (start: number, end: number) => {
    let p = start;
    while (p + 8 <= end) {
      let size = view.getUint32(p);
      const type = tag(p + 4);
      let headerSize = 8;

      if (size === 1) {
        // 64-bit extended size
        size = Number(view.getBigUint64(p + 8));
        headerSize = 16;
      } else if (size === 0) {
        // box extends to end of file
        size = end - p;
      }

      const boxEnd = Math.min(p + size, end);

      if (TIME_BOXES.has(type)) {
        const version = u8[p + headerSize];
        const fieldOff = p + headerSize + 4; // skip version(1) + flags(3)
        const bytes = version === 1 ? 16 : 8; // two 64-bit or two 32-bit times
        for (let i = 0; i < bytes; i++) u8[fieldOff + i] = 0;
      } else if (type === "hdlr") {
        // name string starts after: version/flags(4) + predefined(4) + type(4) + reserved(12)
        const nameOff = p + headerSize + 24;
        for (let i = nameOff; i < boxEnd; i++) u8[i] = 0;
      } else if (CONTAINERS.has(type)) {
        walk(p + headerSize, boxEnd);
      }

      if (size <= 0) break;
      p = boxEnd;
    }
  };

  walk(0, buffer.byteLength);
  return buffer;
}
