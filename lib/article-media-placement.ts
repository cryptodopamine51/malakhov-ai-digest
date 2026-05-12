export interface InlineImageSlotOptions {
  firstSlotAfterParagraph?: number
  minParagraphSpacing?: number
  stepParagraphs?: number
}

export function selectInlineImageSlots(
  paragraphCount: number,
  imageCount: number,
  options: InlineImageSlotOptions = {},
): number[] {
  const safeParagraphCount = Math.max(0, Math.floor(paragraphCount))
  const safeImageCount = Math.max(0, Math.floor(imageCount))
  if (safeParagraphCount < 4 || safeImageCount < 1) return []

  const firstSlotAfterParagraph = Math.max(0, Math.floor(options.firstSlotAfterParagraph ?? 2))
  const minParagraphSpacing = Math.max(1, Math.floor(options.minParagraphSpacing ?? 3))
  const stepParagraphs = Math.max(minParagraphSpacing, Math.floor(options.stepParagraphs ?? 4))
  const lastAllowedSlot = safeParagraphCount - 2
  const slots: number[] = []

  for (
    let slot = Math.min(firstSlotAfterParagraph, lastAllowedSlot);
    slot <= lastAllowedSlot && slots.length < safeImageCount;
    slot += stepParagraphs
  ) {
    const previousSlot = slots[slots.length - 1]
    if (previousSlot === undefined || slot - previousSlot >= minParagraphSpacing) {
      slots.push(slot)
    }
  }

  return slots
}
