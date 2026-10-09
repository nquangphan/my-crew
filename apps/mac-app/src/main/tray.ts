import { Menu, type NativeImage, nativeImage, Tray } from 'electron';

export type DotColor = 'gray' | 'green' | 'yellow' | 'red';

const RGB: Record<DotColor, [number, number, number]> = {
  gray: [142, 150, 163],
  green: [31, 132, 90],
  yellow: [185, 122, 0],
  red: [201, 55, 44],
};

/** Hình tròn vẽ thẳng vào bitmap BGRA (1x và 2x), nên không cần file ảnh. */
function dot(color: DotColor): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = 16 * scale;
    const radius = 5 * scale;
    const center = size / 2;
    const pixels = Buffer.alloc(size * size * 4);
    const [r, g, b] = RGB[color];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const alpha = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(x + 0.5 - center, y + 0.5 - center)));
        const offset = (y * size + x) * 4;
        pixels[offset] = b;
        pixels[offset + 1] = g;
        pixels[offset + 2] = r;
        pixels[offset + 3] = Math.round(alpha * 255);
      }
    }
    image.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: pixels });
  }
  return image;
}

export interface TrayState {
  color: DotColor;
  /** Số run đang chạy; `null` khi chưa biết (AP-3 điền). */
  runs: number | null;
}

export interface TrayActions {
  open: () => void;
  quit: () => void;
}

/** Biểu tượng menu bar: chấm màu, số run và hai việc hằng ngày. */
export class CrewTray {
  private readonly tray: Tray;
  private readonly images = new Map<DotColor, NativeImage>();
  private state: TrayState = { color: 'gray', runs: null };

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(this.image('gray'));
    this.tray.setToolTip('2P Crew');
    this.update(this.state);
  }

  private image(color: DotColor): NativeImage {
    let image = this.images.get(color);
    if (!image) {
      image = dot(color);
      this.images.set(color, image);
    }
    return image;
  }

  update(state: TrayState): void {
    this.state = state;
    this.tray.setImage(this.image(state.color));
    this.tray.setTitle(state.runs && state.runs > 0 ? ` ${state.runs}` : '');
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: trayStatusLabel(state), enabled: false },
        { type: 'separator' },
        { label: 'Mở 2P Crew', click: this.actions.open },
        { label: 'Thoát', click: this.actions.quit },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}

export function trayStatusLabel(state: TrayState): string {
  const runs = state.runs === null ? 'chưa rõ số run' : `${state.runs} run đang chạy`;
  return `2P Crew · ${runs}`;
}
