import type { Quad } from "../detection/types";
import { dstCornersForSize, homographyDstToSrc, warpOutputSize } from "./homography";

export interface WarpRgbaOptions {
  minOutputWidth?: number;
}

export interface WarpRgbaResult {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_dstSize;
uniform vec2 u_texSize;
uniform mat3 u_dstToSrc;
varying vec2 v_uv;

void main() {
  vec2 dst = vec2(v_uv.x * (u_dstSize.x - 1.0), (1.0 - v_uv.y) * (u_dstSize.y - 1.0));
  vec3 mapped = u_dstToSrc * vec3(dst, 1.0);
  vec2 src = mapped.xy / mapped.z;
  vec2 uv = (src + 0.5) / u_texSize;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = texture2D(u_source, uv);
}
`;

let glCanvas: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let vbo: WebGLBuffer | null = null;
let uDstToSrc: WebGLUniformLocation | null = null;
let uDstSize: WebGLUniformLocation | null = null;
let uTexSize: WebGLUniformLocation | null = null;
let uSource: WebGLUniformLocation | null = null;

function ensureContext(): WebGLRenderingContext {
  if (gl && program && vbo && uDstToSrc && uDstSize && uTexSize && uSource) return gl;

  glCanvas = document.createElement("canvas");
  gl = glCanvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL is not available");

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WebGL link failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  uDstToSrc = gl.getUniformLocation(program, "u_dstToSrc");
  uDstSize = gl.getUniformLocation(program, "u_dstSize");
  uTexSize = gl.getUniformLocation(program, "u_texSize");
  uSource = gl.getUniformLocation(program, "u_source");

  vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  return gl;
}

function compileShader(context: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = context.createShader(type)!;
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const log = context.getShaderInfoLog(shader);
    context.deleteShader(shader);
    throw new Error(`WebGL compile failed: ${log}`);
  }
  return shader;
}

/** Row-major 3×3 → column-major for WebGL `uniformMatrix3fv`. */
function toGlMat3(rowMajor: Float32Array): Float32Array {
  return new Float32Array([
    rowMajor[0]!, rowMajor[3]!, rowMajor[6]!,
    rowMajor[1]!, rowMajor[4]!, rowMajor[7]!,
    rowMajor[2]!, rowMajor[5]!, rowMajor[8]!,
  ]);
}

/**
 * Perspective-correct an RGBA image using WebGL (inverse homography + bilinear sampling).
 */
export function warpRgba(
  source: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  quad: Quad,
  options: WarpRgbaOptions = {},
): WarpRgbaResult {
  const { width, height } = warpOutputSize(quad, options.minOutputWidth ?? 0, {
    width: srcWidth,
    height: srcHeight,
  });
  const dstCorners = dstCornersForSize(width, height);
  const h = toGlMat3(homographyDstToSrc(dstCorners, quad));

  const context = ensureContext();
  const canvas = glCanvas!;
  canvas.width = width;
  canvas.height = height;
  context.viewport(0, 0, width, height);

  const texture = context.createTexture()!;
  context.activeTexture(context.TEXTURE0);
  context.bindTexture(context.TEXTURE_2D, texture);
  context.pixelStorei(context.UNPACK_ALIGNMENT, 4);
  context.texImage2D(
    context.TEXTURE_2D,
    0,
    context.RGBA,
    srcWidth,
    srcHeight,
    0,
    context.RGBA,
    context.UNSIGNED_BYTE,
    source,
  );
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);

  context.useProgram(program!);
  const aPos = context.getAttribLocation(program!, "a_position");
  context.bindBuffer(context.ARRAY_BUFFER, vbo!);
  context.enableVertexAttribArray(aPos);
  context.vertexAttribPointer(aPos, 2, context.FLOAT, false, 0, 0);

  context.uniformMatrix3fv(uDstToSrc!, false, h);
  context.uniform2f(uDstSize!, width, height);
  context.uniform2f(uTexSize!, srcWidth, srcHeight);
  context.uniform1i(uSource!, 0);

  context.clearColor(0, 0, 0, 0);
  context.clear(context.COLOR_BUFFER_BIT);
  context.drawArrays(context.TRIANGLE_STRIP, 0, 4);

  const out = new Uint8ClampedArray(width * height * 4);
  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, out);
  flipRowsInPlace(out, width, height);

  context.deleteTexture(texture);

  return { width, height, data: out };
}

function flipRowsInPlace(data: Uint8ClampedArray, width: number, height: number): void {
  const rowBytes = width * 4;
  const scratch = new Uint8ClampedArray(rowBytes);
  const half = Math.floor(height / 2);
  for (let y = 0; y < half; y++) {
    const top = y * rowBytes;
    const bottom = (height - 1 - y) * rowBytes;
    scratch.set(data.subarray(top, top + rowBytes));
    data.copyWithin(top, bottom, bottom + rowBytes);
    data.set(scratch, bottom);
  }
}
