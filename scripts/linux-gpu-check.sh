#!/usr/bin/env bash
# What a Linux machine offers the playground: the GPU and its drivers, the
# OpenGL and Vulkan they provide (WebGL sits on the first, WebGPU on the
# second), and how Firefox and Chrome are installed and set up.
#
# It only reads: no sudo, nothing installed or changed. The report goes to
# the terminal and to ~/empyrean-gpu-check.txt; read it before sending it.
# Paths under your home directory are shown as ~.
#
#   bash linux-gpu-check.sh

set -u
out="$HOME/empyrean-gpu-check.txt"

section() { printf '\n=== %s ===\n' "$1"; }

# Runs a command if it exists, or names the package that brings it.
run() {
  pkg=$1
  shift
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '$ %s\n(no %s here: "sudo apt install %s" adds it, then run this again)\n' "$*" "$1" "$pkg"
    return
  fi
  printf '$ %s\n' "$*"
  # A tool that waits on a display that never answers mustn't hang the rest.
  timeout 20 "$@" 2>&1 | head -n 120
}

# The installed version of each Debian package, or "not installed".
packages() {
  for p in "$@"; do
    v=$(dpkg-query -W -f='${Status} ${Version}' "$p" 2>/dev/null)
    case "$v" in
      "install ok installed "*) printf '%-26s %s\n' "$p" "${v##* }" ;;
      *) printf '%-26s not installed\n' "$p" ;;
    esac
  done
}

# Only the graphics prefs a profile has changed, never the rest of prefs.js.
firefox_prefs() {
  for dir in "$HOME/.mozilla/firefox" "$HOME/.config/mozilla/firefox" \
    "$HOME/snap/firefox/common/.mozilla/firefox"; do
    [ -d "$dir" ] || continue
    for prefs in "$dir"/*/prefs.js; do
      [ -f "$prefs" ] || continue
      printf '%s\n' "$prefs"
      grep -E '"(dom\.webgpu|gfx\.webgpu|webgl\.|gfx\.webrender|layers\.acceleration|media\.hardware-video|widget\.dmabuf)' \
        "$prefs" || echo "  (no graphics prefs changed)"
    done
  done
}

{
  echo "Empyrean Gate: Linux GPU check, $(date '+%Y-%m-%d %H:%M %Z')"

  section "System"
  grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release 2>/dev/null
  echo "kernel: $(uname -r) ($(uname -m))"
  echo "session: ${XDG_SESSION_TYPE:-unknown}, desktop: ${XDG_CURRENT_DESKTOP:-unknown}"

  section "GPU and its kernel driver"
  if command -v lspci >/dev/null 2>&1; then
    lspci -nnk | grep -A3 -E 'VGA|3D controller|Display controller'
  else
    echo '(no lspci here: "sudo apt install pciutils" adds it)'
  fi
  echo
  echo "kernel modules loaded:"
  lsmod 2>/dev/null | grep -E '^(amdgpu|radeon|i915|xe|nouveau|nvidia) ' || echo "  (none of amdgpu, radeon, i915, xe, nouveau, nvidia)"
  echo
  echo "/dev/dri:"
  ls -l /dev/dri 2>&1
  echo "your groups: $(id -nG)"

  section "Kernel messages about the GPU"
  echo "(needs the adm group or systemd-journal; nothing if not allowed)"
  journalctl -k -b --no-pager 2>/dev/null |
    grep -i -E 'amdgpu|radeon|drm|firmware' | grep -i -E 'error|fail|firmware|unsupported|not found' |
    tail -n 30

  section "Graphics packages"
  packages libgl1-mesa-dri libegl-mesa0 libglx-mesa0 mesa-vulkan-drivers \
    libvulkan1 linux-firmware xserver-xorg-video-amdgpu mesa-utils vulkan-tools
  echo
  echo "Vulkan drivers installed (/usr/share/vulkan/icd.d):"
  ls /usr/share/vulkan/icd.d 2>&1

  section "OpenGL (what WebGL uses)"
  run mesa-utils glxinfo -B
  echo
  run mesa-utils eglinfo -B

  section "Vulkan (what WebGPU uses on Linux)"
  run vulkan-tools vulkaninfo --summary

  section "Firefox"
  command -v firefox >/dev/null 2>&1 || echo "(no firefox on PATH)"
  for f in firefox firefox-esr; do
    command -v "$f" >/dev/null 2>&1 || continue
    echo "$f: $(readlink -f "$(command -v "$f")")"
    "$f" --version 2>&1 | head -n 1
  done
  echo
  if command -v snap >/dev/null 2>&1; then
    snap list firefox 2>&1
    echo
    echo "snaps Firefox takes its graphics libraries from:"
    snap connections firefox 2>/dev/null | grep -E 'gnome|mesa|gpu|graphics|opengl' || echo "  (none listed)"
    snap list 2>/dev/null | grep -E '^(gnome-|mesa-|gpu-)' || true
  else
    echo "(no snap here)"
  fi
  echo
  echo "Flatpak:"
  if command -v flatpak >/dev/null 2>&1; then
    flatpak list --app 2>/dev/null | grep -i firefox || echo "  (no Firefox flatpak)"
  else
    echo "  (no flatpak here)"
  fi
  echo
  echo "Graphics prefs changed in Firefox profiles:"
  firefox_prefs

  section "Chrome"
  for c in google-chrome google-chrome-stable chromium chromium-browser; do
    command -v "$c" >/dev/null 2>&1 && echo "$c: $("$c" --version 2>/dev/null)"
  done
  echo "(nothing listed means no Chrome or Chromium)"
} 2>&1 | sed "s#$HOME#~#g" | tee "$out"

printf '\nSaved to ~/empyrean-gpu-check.txt. Have a look, then send it back.\n'
