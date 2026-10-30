const CHUNK = 4096;

/**
 * Encodes a PNG as kitty graphics protocol escapes that show the image `cols` cells wide.
 * The terminal keeps the aspect ratio. The protocol sends the data in chunks of 4096 base64
 * characters, and each chunk except the last has `m=1`.
 */
export function kittyImage(png: Uint8Array, cols: number): string {
  const data = Buffer.from(png).toString("base64");
  let out = "";
  for (let i = 0; i < data.length; i += CHUNK) {
    const more = i + CHUNK < data.length ? 1 : 0;
    const keys = i === 0 ? `a=T,f=100,c=${cols},m=${more}` : `m=${more}`;
    out += `\x1b_G${keys};${data.slice(i, i + CHUNK)}\x1b\\`;
  }
  return out;
}
