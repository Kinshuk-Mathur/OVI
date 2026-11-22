# OVI

A frontend-only personal companion and journal, built with Next.js, React, TypeScript, Tailwind CSS, Lucide, and TipTap.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For a production build, run `npm run build` followed by `npm start`. With Node.js 22 or newer, run `npm run test:dates` to check local calendar calculations.

## Journal

The Journal library keeps entries in this browser's IndexedDB. Each entry has a stable local journal date and separate creation and modification timestamps; editing does not change its journal date. An earlier single draft is preserved in place. Since the previous format did not record its creation date, it appears under Date needed until you enter the original date. Text, title, photo placement, and photo sizes are saved locally after a short pause. Photos can be inserted from the photo button, pasted, or dropped into the editor; JPEG, PNG, WebP, and GIF files up to 12 MB each are supported. Click a photo to show its controls; drag the photo or use the controls to move, resize, or remove it. Photos can sit next to each other on wider screens, with writing continuing below them. Each photo tape can hold a short note. Removed photo data is retained in local browser storage so editor undo can restore it. Clearing the browser's site data removes the entries and photos; there is no cloud backup. Avoid editing the same entry in multiple tabs at once, since this prototype does not reconcile concurrent edits.

The Journal's Talk to OVI button saves the current draft and opens the chat with a local journal reference and title indicator. It does not transmit journal content or generate a response. Chat sending and attachments remain unavailable.

The decorative foliage, landscape, and sidebar plants are clipped from the supplied OVI reference artwork in `public/ovi-reference-art.png`. The OVI wordmark and flower use the supplied `public/Refined Terracotta OVI Logo.png` artwork. The interface itself is built from separate components. The display fonts load from Google Fonts, with local serif and sans-serif fallbacks.

The Journal’s three-dot menu opens a fullscreen writing view using the browser Fullscreen API, where supported. Select text to show the bold, underline, and highlight controls.
