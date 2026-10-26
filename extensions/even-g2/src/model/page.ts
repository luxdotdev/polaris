/**
 * A glasses page as plain data: text and list containers on the 576 × 288
 * canvas, exactly one of them capturing input.
 */

export const WIDTH = 576;

export const HEIGHT = 288;

export const HEADER_HEIGHT = 40;

/** Text set at create or rebuild holds 1,000 UTF-8 bytes; leave room. */
export const MAX_TEXT = 960;

export interface Box {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly capture: boolean;
}

export interface TextBox extends Box {
  readonly content: string;
}

export interface ListBox extends Box {
  readonly items: ReadonlyArray<string>;
}

export interface Page {
  readonly texts: ReadonlyArray<TextBox>;
  readonly lists: ReadonlyArray<ListBox>;
}

/**
 * What forces a rebuild: the containers, their places and list rows. Text
 * alone changes in place.
 */
export const layoutKey = (page: Page) =>
  JSON.stringify([page.texts.map(({ content: _content, ...box }) => box), page.lists]);
