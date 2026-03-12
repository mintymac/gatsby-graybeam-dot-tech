---
title: "Making the Framework 16 Macropad Actually Useful with Per-Key RGB and OS Integration"
category: "Engineering"
author: McHughson Chambers
date: 2026-03-06
---

The Framework Laptop 16 ships with a swappable RGB macropad module — a 24-key numpad with per-key LEDs driven by an IS31FL3743A controller. Out of the box, it does rainbow swirls. Pretty, but not useful.

I wanted three things: color-coded keys by function, automatic layer switching when I toggle numlock, and night mode that shifts to deep reds when the desktop goes dark. Here's how I got there.

## The problem: kitty protocol meets numpad keycodes

The first surprise had nothing to do with LEDs. I use Ghostty inside tmux, and when I toggled numlock off, the macropad started printing raw escape sequences:

```
[57427u[57417u[57419u[57423u
```

These are [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/) codepoints. The protocol solves a real problem — VT100-era terminals can't distinguish numpad 7 from regular 7, or Ctrl+I from Tab. Kitty assigns every key a unique Unicode codepoint, so `KC_P7` (numpad 7) sends `57423` while regular `KC_7` sends ASCII `55`.

The macropad's QMK firmware uses numpad keycodes (`KC_P0`–`KC_P9`, `KC_PENT`, etc.). Ghostty dutifully encodes them as kitty-protocol numpad codepoints. Most apps don't speak this protocol yet, so they print the raw sequences.

**The fix:** swap all numpad keycodes for regular equivalents. `KC_7` instead of `KC_P7`, `KC_ENT` instead of `KC_PENT`. The numbers work everywhere now.

## Layer-aware color coding

The macropad has two layers toggled by numlock:

**Numlock ON** — the numpad:
- **Cyan** — number keys (0–9)
- **Orange** — operators (+, -, \*, /, =, .)
- **Magenta** — function keys (Esc, Calc, Backspace, NumLock)
- **Green** — Enter

**Numlock OFF** — navigation + RGB controls:
- **Blue** — navigation (arrows, Home/End, PgUp/PgDn, Ins, Del)
- **Pink** — RGB effect controls
- **Yellow** — backlight stepping

Each key type gets a distinct color so you can see at a glance what layer you're on and what each key does. No memorization required.

## Talking to the LEDs from Linux

Framework's macropad firmware includes an `rgb_remote` feature — a raw HID interface that lets the host computer control individual LEDs. The protocol is simple: send a 32-byte HID report with a command byte, RGB values, and a list of LED indices.

The tricky part is mapping **layout positions** to **LED indices**. The physical layout is a 6×4 grid, but the underlying matrix is 4×8 with a non-obvious mapping through the IS31FL3743A driver. The `g_led_config` struct in `macropad.c` defines this mapping, and it took some matrix algebra to get a clean layout-position-to-LED-index table:

```python
LAYOUT_TO_LED = [
    5,  2, 22, 17,   # Row 0: Esc, Calc, =, Bksp
    4,  0, 20, 18,   # Row 1: Num, /, *, -
    7,  1, 21, 16,   # Row 2: 7, 8, 9, +
    6,  3, 23, 19,   # Row 3: 4, 5, 6, +
    9, 11, 15, 13,   # Row 4: 1, 2, 3, Enter
    8, 10, 14, 12,   # Row 5: 0, 0, ., Enter
]
```

With this table, setting colors by key type is just a loop — classify each layout position, look up its LED index, set the color.

## Night mode: deep reds for dark rooms

Staring at cyan LEDs at 1am is hostile. The color controller has two palettes:

**Day mode** — vibrant, high-contrast colors for visibility in ambient light.

**Night mode** — deep reds and embers with zero blue channel. Red light has the least impact on dark-adapted vision, and the warm tones feel right alongside a dark desktop theme.

```python
NIGHT_COLORS = {
    'num':   (150, 20, 0),      # deep red-orange
    'oper':  (100, 12, 0),      # ember
    'func':  (180, 0, 0),       # deep red
    'enter': (130, 30, 0),      # dark amber
}
```

The IS31FL3743A has a hardware current limit (`ISSI_GLOBALCURRENT 185`) that caps total draw at ~500mA regardless of what RGB values you send, so there's no thermal concern pushing channels to 180.

## Auto-switching with systemd

A Python script watches two signals:

1. **Numlock state** — read from `/sys/class/leds/input*::numlock/brightness` every 300ms
2. **Dark mode** — reads COSMIC desktop's theme config at `~/.config/cosmic/com.system76.CosmicTheme.Mode/v1/is_dark`, with a time-of-day fallback (after 9pm = night mode)

When either changes, it updates all 24 LEDs. A systemd user service keeps it running:

```ini
[Service]
Type=simple
ExecStart=python3 macropad_colors.py --watch
ExecStop=python3 macropad_colors.py --off
Restart=on-failure
```

Toggle numlock and the colors shift instantly. Switch COSMIC to dark mode and the macropad follows within a second.

## The full stack

The repo is at [github.com/GrayBeamTechnology/framework-macropad-rgb](https://github.com/GrayBeamTechnology/framework-macropad-rgb). It includes:

- Modified QMK keymap with regular keycodes (no more kitty protocol issues)
- `macropad_colors.py` — layer-aware color controller with day/night palettes
- `RgbRemote.py` — HID interface for the macropad's rgb_remote feature
- systemd service file for auto-watching
- LED index mapping documentation

## Update: surviving a firmware update (March 2026)

Framework pushed firmware v0.3.1 through fwupd (the Linux firmware update service). GNOME Software offered the update, I accepted, and my custom RGB setup went dark — the stock firmware overwrites the custom QMK build and doesn't include `rgb_remote`.

### The recovery workflow

The good news: you don't need to physically reset the macropad. The RP2040 bootloader can be triggered from software using `fwupdtool`:

```bash
# 1. Find the macropad's device ID
fwupdmgr get-devices | grep -A 5 'Macropad'

# 2. Reboot into bootloader (mounts as RPI-RP2 USB drive)
sudo fwupdtool detach <device-id-or-guid>

# 3. Mount and flash the custom UF2
sudo mount /dev/sdX1 /mnt
sudo cp framework_macropad_default.uf2 /mnt/
sync
sudo umount /mnt

# 4. Macropad reboots automatically — reapply colors
python3 macropad_colors.py
```

### Rebasing onto v0.3.1

Flashing the old v0.2.9-based firmware just kicks the can — fwupd sees the version mismatch and nags you to update again. The real fix is rebasing the custom changes onto Framework's v0.3.1 release.

The `rgb_remote` code is well-isolated (two files plus a few integration points), so the rebase is straightforward:

1. Add Framework's repo as a remote and fetch tags
2. Create a new branch from `v0.3.1`
3. Copy `rgb_remote.c` and `rgb_remote.h` from the old branch
4. Re-apply the two integration hooks: the `#include` and HID dispatch case in `factory.c`, and `SRC += rgb_remote.c` in `macropad/rules.mk`
5. Rebuild with `make framework/macropad:default`

Framework's v0.3.1 changes were minimal — a suspend/wake tracking flag and a new Copilot keycode (`KC_CPLT` sends Win+Shift+F23). No conflicts with `rgb_remote`.

### Bonus: the Copilot key

v0.3.1 adds `KC_CPLT`, a keycode that sends Win+Shift+F23 — intended for the Windows Copilot shortcut, but on Linux it's just a free key combo you can bind to anything. I mapped it to the dead center of the FN layer's arrow cluster (the key that was previously unmapped):

```
┌──────┬──────┬──────┬──────┐
│ Home │  ↑   │ PgUp │  ... │
├──────┼──────┼──────┼──────┤
│  ←   │ CPLT │  →   │  ... │
├──────┼──────┼──────┼──────┤
│ End  │  ↓   │ PgDn │  ... │
└──────┴──────┴──────┴──────┘
```

It gets its own color — teal in day mode, deep plum at night — so it stands out from the blue navigation keys. Bind Win+Shift+F23 to whatever you want in your desktop shortcuts.

### Lesson learned

If you're running custom QMK firmware on Framework hardware, **match your firmware version to the latest fwupd release**. Otherwise the update system will keep trying to "help" by overwriting your build. Rebasing is cheap when the custom code is isolated — the entire process took about ten minutes.

## Shout out to Framework

This whole project is possible because Framework designed the macropad with an open firmware (QMK), a programmable LED controller, and a raw HID interface for host control. Most hardware vendors would have locked this behind proprietary software. Framework shipped it as an open platform.

The modular input system on the Framework 16 — swappable keyboard, macropad, and spacer modules — is one of those designs that keeps paying off the more you dig into it. Being able to flash custom firmware onto a laptop numpad and control its LEDs from a Python script on Linux is exactly the kind of thing that makes hardware worth investing in.
