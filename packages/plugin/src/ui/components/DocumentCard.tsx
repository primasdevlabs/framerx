import type { FramerDocument } from '@framer/compiler-parser';

import { countImages, countNodes, uniqueFontFamilies } from '../../utils/format';

interface DocumentCardProps {
    document: FramerDocument;
}

export function DocumentCard({ document }: DocumentCardProps) {
    const nodes = document.nodes as unknown as Array<{ type?: string; image?: { src?: string } | null; text?: { style?: { fontFamily?: string } } | null; children?: unknown[] }>;
    const nodeCount = countNodes(nodes as Array<{ children?: unknown[] }>);
    const assetCount = countImages(nodes);
    const fontCount = uniqueFontFamilies(nodes).length;

    return (
        <section className="fx-card">
            <h2 className="fx-card__title">Document</h2>
            <p className="fx-doc__name" title={document.name}>
                {document.name}
            </p>
            <p className="fx-doc__source">
                {document.metadata?.source === 'framer' ? 'Framer project' : 'Design document'} · v{document.version ?? '1.0.0'}
            </p>
            <div className="fx-stats">
                <div className="fx-stat">
                    <div className="fx-stat__value">{document.nodes.length}</div>
                    <div className="fx-stat__label">Sections</div>
                </div>
                <div className="fx-stat">
                    <div className="fx-stat__value">{nodeCount}</div>
                    <div className="fx-stat__label">Nodes</div>
                </div>
                <div className="fx-stat">
                    <div className="fx-stat__value">{assetCount}</div>
                    <div className="fx-stat__label">Assets</div>
                </div>
                <div className="fx-stat">
                    <div className="fx-stat__value">{fontCount}</div>
                    <div className="fx-stat__label">Fonts</div>
                </div>
            </div>
        </section>
    );
}
