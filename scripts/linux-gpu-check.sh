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

# Every Firefox profile's prefs.js: the deb's, the newer XDG place, the snap's.
prefs_files() {
  for prefs in "$HOME"/.mozilla/firefox/*/prefs.js \
    "$HOME"/.config/mozilla/firefox/*/prefs.js \
    "$HOME"/snap/firefox/common/.mozilla/firefox/*/prefs.js; do
    [ -f "$prefs" ] && printf '%s\n' "$prefs"
  done
}

# Only the graphics prefs a profile has changed, never the rest of prefs.js.
firefox_prefs() {
  while read -r prefs; do
    printf '%s\n' "$prefs"
    grep -E '"(dom\.webgpu|gfx\.webgpu|webgl\.|gfx\.webrender|layers\.acceleration|media\.hardware-video|widget\.dmabuf)' \
      "$prefs" || echo "  (no graphics prefs changed)"
  done < <(prefs_files)
}

have() { command -v "$1" >/dev/null 2>&1; }
installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

# The summary's lines.
good() { printf '  ok    %s\n' "$1"; }
bad() {
  problems=$((problems + 1))
  printf '  FIX   %s\n' "$1"
}
try() { printf '  try   %s\n' "$1"; }
# The rest of a line, carried onto the next.
also() { printf '        %s\n' "$1"; }
# A command to copy, on lines of its own.
cmd() { printf '\n%s\n\n' "$1" | sed 's/^./        &/'; }
need() { cmd "sudo apt install $*"; }

# What the details above add up to, each problem with its fix. Everything
# suggested is open source: Ubuntu's own packages, and Mozilla's Firefox.
summary() {
  problems=0
  version_id=$(. /etc/os-release 2>/dev/null && echo "${VERSION_ID:-}")

  tools=""
  have lspci || tools="$tools pciutils"
  have glxinfo || tools="$tools mesa-utils"
  have vulkaninfo || tools="$tools vulkan-tools"
  if [ -n "$tools" ]; then
    try "missing tools for a full check; install, then run again:"
    need ${tools# }
  fi

  # Each GPU, and the kernel driver bound to it. With none bound, OpenGL and
  # Vulkan can only be software, so those follow from it rather than add to it.
  gpu_dead=""
  if have lspci; then
    while IFS='|' read -r dev drv; do
      [ -n "$dev" ] || continue
      name=$(printf '%s' "${dev#*]: }" |
        sed -E 's/ \[[0-9a-f]{4}:[0-9a-f]{4}\].*//; s/^Advanced Micro Devices, Inc\. \[AMD\/ATI\]/AMD/')
      if [ -n "$drv" ]; then
        good "GPU: $name ($drv)"
        continue
      fi
      gpu_dead=yes
      hwe="linux-generic-hwe-$version_id"
      amd=""
      case "$dev" in *"[1002:"*) amd=yes ;; esac
      if [ -n "$amd" ] && { ! installed linux-firmware || journalctl -k -b --no-pager 2>/dev/null |
        grep -q -i -E 'amdgpu.*firmware.*(fail|error)|Direct firmware load for amdgpu'; }; then
        # Said, not recommended: the firmware isn't open source.
        bad "GPU: $name: no driver bound. amdgpu needs AMD's firmware"
        also "(linux-firmware, closed), and won't start without it."
      elif apt-cache show "$hwe" >/dev/null 2>&1 && ! installed "$hwe"; then
        bad "GPU: $name: no driver bound; kernel $(uname -r) may predate it. HWE kernel, then reboot:"
        cmd "sudo apt install $hwe"
      else
        bad "GPU: $name: no driver bound; kernel $(uname -r) may predate it"
      fi
    done < <(lspci -nnk | awk '
      /VGA|3D controller|Display controller/ { if (dev) print dev "|" drv; dev = $0; drv = ""; next }
      dev && /Kernel driver in use:/ { sub(/.*in use: /, ""); drv = $0; next }
      dev && /^[0-9a-f]/ { print dev "|" drv; dev = "" }
      END { if (dev) print dev "|" drv }')
  fi

  # OpenGL: what WebGL runs on.
  missing=""
  for p in libgl1-mesa-dri libegl-mesa0 libglx-mesa0; do
    installed "$p" || missing="$missing $p"
  done
  if [ -n "$missing" ]; then
    bad "Mesa OpenGL drivers missing:"
    need ${missing# }
  fi
  gl_hw=""
  if have glxinfo; then
    gl=$(timeout 20 glxinfo -B 2>/dev/null | sed -n 's/^OpenGL renderer string: //p')
    case "$gl" in
      "") bad "OpenGL: glxinfo got no answer (no display?)" ;;
      *llvmpipe* | *softpipe* | *[Ss]oftware*)
        gl_hw=no
        if [ -n "$gpu_dead" ]; then
          also "OpenGL: software only ($gl), from the GPU above"
        else
          bad "OpenGL: software only ($gl)"
        fi
        ;;
      *)
        gl_hw=yes
        good "OpenGL: $gl"
        ;;
    esac
  fi

  # Vulkan: what WebGPU runs on, in Firefox and Chrome alike.
  missing=""
  installed libvulkan1 || missing="libvulkan1"
  installed mesa-vulkan-drivers || missing="$missing mesa-vulkan-drivers"
  if have vulkaninfo; then
    vk_gpus=$(timeout 20 vulkaninfo --summary 2>/dev/null |
      awk -F'= ' '/deviceType/ { t = $2 } /deviceName/ { if (t !~ /CPU/) print $2 }' |
      paste -sd, - | sed 's/,/, /g')
    if [ -n "$vk_gpus" ]; then
      good "Vulkan: $vk_gpus"
    elif [ -n "$gpu_dead" ]; then
      also "Vulkan: no GPU device, from the GPU above"
    elif [ -n "$missing" ]; then
      bad "Vulkan: no GPU device (WebGPU needs one):"
      need ${missing# }
    else
      bad "Vulkan: no GPU device, though mesa-vulkan-drivers is installed"
    fi
  elif [ -n "$missing" ]; then
    bad "Vulkan drivers missing (WebGPU needs them):"
    need ${missing# }
  fi

  # Firefox.
  ff_snap=""
  have snap && snap list firefox >/dev/null 2>&1 && ff_snap=yes
  if have firefox || [ -n "$ff_snap" ]; then
    webgl_off="" webgpu_on=""
    while read -r prefs; do
      grep -q '"webgl.disabled", true' "$prefs" && webgl_off=yes
      grep -q '"dom.webgpu.enabled", true' "$prefs" && webgpu_on=yes
    done < <(prefs_files)
    [ -n "$webgl_off" ] && bad "Firefox: webgl.disabled is true (about:config)"
    if [ -n "$webgpu_on" ]; then
      good "Firefox: dom.webgpu.enabled is true"
    else
      try "Firefox: about:config, dom.webgpu.enabled = true, restart"
    fi
    if [ -n "$ff_snap" ] && [ "$gl_hw" != no ]; then
      try "Firefox is the snap, with its own graphics stack. If WebGL2/WebGPU stay"
      also "off, Mozilla's deb uses the system's (installs beside it, new profile):"
      cat <<'EOS' | sed 's/^./        &/'

sudo install -d -m 0755 /etc/apt/keyrings
wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O- | sudo tee /etc/apt/keyrings/packages.mozilla.org.asc > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" | sudo tee /etc/apt/sources.list.d/mozilla.list > /dev/null
printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' | sudo tee /etc/apt/preferences.d/mozilla > /dev/null
sudo apt update && sudo apt install firefox
EOS
    fi
  fi

  if [ "$problems" -eq 0 ] && [ -z "$tools" ]; then
    echo "  Nothing missing system-side."
  fi
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
  section "Summary"
  summary
} 2>&1 | sed "s#$HOME#~#g" | tee "$out"

printf '\nSaved to ~/empyrean-gpu-check.txt. Have a look, then send it back.\n'
