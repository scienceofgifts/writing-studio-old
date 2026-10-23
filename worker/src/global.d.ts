declare module 'unpdf' {
  export function extractText(
    data: Uint8Array | ArrayBuffer,
    options?: { mergePages?: boolean }
  ): Promise<string | string[]>;
}
