/**
 * Asset definitions for the Design AST.
 */

/** The type of an asset. */
export type AssetType = 'image' | 'svg' | 'icon' | 'font' | 'video';

/** A reference to an asset used by a node. */
export interface AssetRef {
    /** The unique ID of the asset. */
    id: string;
    /** The type of the asset. */
    type: AssetType;
    /** The source URL or data URI of the asset. */
    src: string;
    /** The original name of the asset. */
    name?: string;
    /** The width of the asset in px (for images). */
    width?: number;
    /** The height of the asset in px (for images). */
    height?: number;
    /** The MIME type of the asset. */
    mimeType?: string;
    /** The size of the asset in bytes. */
    size?: number;
    /** The alt text for the asset (for accessibility). */
    alt?: string;
    /** The binary data of the asset (if pre-fetched by the exporter). */
    data?: Uint8Array;
    /** The text content (for inline SVGs). */
    text?: string;
}

/** A collected asset for export. */
export interface Asset {
    /** The unique ID of the asset. */
    id: string;
    /** The type of the asset. */
    type: AssetType;
    /** The source URL or data URI of the asset. */
    src: string;
    /** The original name of the asset. */
    name: string;
    /** The sanitized file name (without extension). */
    fileName: string;
    /** The file extension. */
    extension: string;
    /** The width of the asset in px (for images). */
    width?: number;
    /** The height of the asset in px (for images). */
    height?: number;
    /** The MIME type of the asset. */
    mimeType?: string;
    /** The size of the asset in bytes. */
    size?: number;
    /** The alt text for the asset (for accessibility). */
    alt?: string;
    /** The binary data of the asset (if available). */
    data?: Uint8Array;
    /** The text content of the asset (for SVGs). */
    text?: string;
}

/** A font asset definition. */
export interface FontAsset {
    /** The font family name. */
    family: string;
    /** The font weight. */
    weight: number;
    /** The font style. */
    style: 'normal' | 'italic';
    /** The font file URLs. */
    sources: Array<{
        /** The source URL, when the plugin API exposes one. */
        url: string;
        format: 'woff' | 'woff2' | 'ttf' | 'otf';
        /** The original font bytes, when accessible through the source API. */
        data?: Uint8Array;
        /** The source MIME type, when exposed. */
        mimeType?: string;
    }>;
}