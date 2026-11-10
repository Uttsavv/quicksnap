// Browser APIs that TypeScript's DOM lib doesn't describe yet.

interface DocumentPictureInPictureOptions {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
}

interface DocumentPictureInPicture extends EventTarget {
    requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
    readonly window: Window | null;
}

interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
}

declare module "gifenc" {
    export type Palette = number[][];
    export interface Encoder {
        writeFrame(
            index: Uint8Array,
            width: number,
            height: number,
            opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; dispose?: number },
        ): void;
        finish(): void;
        bytes(): Uint8Array;
    }
    export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder;
    export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: string }): Palette;
    export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
}
