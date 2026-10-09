#!/bin/bash
# Reads ffmpeg output files and generates progress.html

OUTDIR="/private/tmp/claude-501/-Users-tomas-Documents-code-tomaswebsite/ddfb3695-f22f-4400-aae9-f28075c261b3/tasks"
HTML="/Users/tomas/Documents/code/tomaswebsite/progress.html"

declare -A NAMES TOTALS FILES
NAMES[bpob0c9r4]="JPL and the Space Age"
NAMES[btedwzvzo]="1999 A.D. (1967)"
NAMES[bqfg1k2n6]="A Is for Atom (1953)"
NAMES[be4m7c0yj]="The Age of Curiosity (1963)"

TOTALS[bpob0c9r4]=3342.14
TOTALS[btedwzvzo]=1559.13
TOTALS[bqfg1k2n6]=919.59
TOTALS[be4m7c0yj]=0  # will detect

FILES[bpob0c9r4]="$OUTDIR/bpob0c9r4.output"
FILES[btedwzvzo]="$OUTDIR/btedwzvzo.output"
FILES[bqfg1k2n6]="$OUTDIR/bqfg1k2n6.output"
FILES[be4m7c0yj]="$OUTDIR/be4m7c0yj.output"

get_time_seconds() {
    local file="$1"
    local time_str
    time_str=$(strings "$file" 2>/dev/null | grep -o 'time=[0-9:\.]*' | tail -1 | sed 's/time=//')
    if [ -z "$time_str" ]; then echo "0"; return; fi
    local h m s
    h=$(echo "$time_str" | cut -d: -f1)
    m=$(echo "$time_str" | cut -d: -f2)
    s=$(echo "$time_str" | cut -d: -f3)
    echo "$h * 3600 + $m * 60 + $s" | bc
}

get_speed() {
    local file="$1"
    strings "$file" 2>/dev/null | grep -o 'speed=[0-9\.]*x' | tail -1 | sed 's/speed=//'
}

is_done() {
    local file="$1"
    strings "$file" 2>/dev/null | grep -q "muxing overhead" && echo "1" || echo "0"
}

# detect Age of Curiosity total duration
curiosity_probe=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/Users/tomas/Documents/code/tomaswebsite/The Age of Curiosity (1963) - National Film Preservation Foundation (1080p, h264).mp4" 2>/dev/null)
if [ -n "$curiosity_probe" ]; then
    TOTALS[be4m7c0yj]=$(echo "$curiosity_probe - 11" | bc)
fi

while true; do
    ROWS=""
    ALL_DONE=true

    for id in bpob0c9r4 btedwzvzo bqfg1k2n6 be4m7c0yj; do
        name="${NAMES[$id]}"
        total="${TOTALS[$id]}"
        file="${FILES[$id]}"
        done_flag=$(is_done "$file")
        current=$(get_time_seconds "$file")
        speed=$(get_speed "$file")

        if [ "$done_flag" = "1" ]; then
            pct=100
            status="Done"
            bar_color="#22c55e"
            speed_text=""
        elif [ "$total" != "0" ] && [ "$(echo "$total > 0" | bc)" = "1" ]; then
            pct=$(echo "scale=1; $current / $total * 100" | bc 2>/dev/null)
            pct=${pct:-0}
            # cap at 99 if not done
            if [ "$(echo "$pct >= 100" | bc)" = "1" ]; then pct="99.9"; fi
            status="Encoding"
            bar_color="#3b82f6"
            speed_text="$speed"
            ALL_DONE=false
        else
            pct=0
            status="Waiting"
            bar_color="#6b7280"
            speed_text=""
            ALL_DONE=false
        fi

        # format current time
        cur_min=$(echo "scale=0; $current / 60" | bc 2>/dev/null)
        cur_sec=$(printf "%02.0f" $(echo "$current - $cur_min * 60" | bc 2>/dev/null) 2>/dev/null)
        tot_min=$(echo "scale=0; $total / 60" | bc 2>/dev/null)
        tot_sec=$(printf "%02.0f" $(echo "$total - $tot_min * 60" | bc 2>/dev/null) 2>/dev/null)

        ROWS="$ROWS
        <div class=\"card\">
            <div class=\"card-header\">
                <span class=\"title\">$name</span>
                <span class=\"status $( [ "$done_flag" = "1" ] && echo "done" || echo "" )\">$status${speed_text:+ · $speed_text}</span>
            </div>
            <div class=\"bar-bg\">
                <div class=\"bar\" style=\"width: ${pct}%; background: $bar_color;\"></div>
            </div>
            <div class=\"card-footer\">
                <span>${cur_min}:${cur_sec} / ${tot_min}:${tot_sec}</span>
                <span class=\"pct\">${pct}%</span>
            </div>
        </div>"
    done

    TIMESTAMP=$(date '+%H:%M:%S')

    cat > "$HTML" <<HTMLEOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="3">
<title>Encoding Progress</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', system-ui, sans-serif;
        background: #0a0a0a;
        color: #e5e5e5;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 48px 24px;
    }
    h1 {
        font-size: 14px;
        font-weight: 500;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #737373;
        margin-bottom: 32px;
    }
    .container {
        width: 100%;
        max-width: 560px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .card {
        background: #141414;
        border: 1px solid #262626;
        border-radius: 12px;
        padding: 20px;
    }
    .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
    }
    .title {
        font-size: 15px;
        font-weight: 600;
        color: #fafafa;
    }
    .status {
        font-size: 12px;
        color: #a3a3a3;
        font-variant-numeric: tabular-nums;
    }
    .status.done {
        color: #22c55e;
    }
    .bar-bg {
        width: 100%;
        height: 6px;
        background: #262626;
        border-radius: 3px;
        overflow: hidden;
    }
    .bar {
        height: 100%;
        border-radius: 3px;
        transition: width 2s ease;
    }
    .card-footer {
        display: flex;
        justify-content: space-between;
        margin-top: 10px;
        font-size: 12px;
        color: #737373;
        font-variant-numeric: tabular-nums;
    }
    .pct {
        font-weight: 600;
        color: #a3a3a3;
    }
    .timestamp {
        font-size: 12px;
        color: #525252;
        margin-top: 24px;
    }
</style>
</head>
<body>
    <h1>Encoding Progress</h1>
    <div class="container">
        $ROWS
    </div>
    <p class="timestamp">Updated $TIMESTAMP · refreshes every 3s</p>
</body>
</html>
HTMLEOF

    if [ "$ALL_DONE" = true ]; then
        # write one final version without auto-refresh
        sed -i '' 's/meta http-equiv="refresh" content="3"//' "$HTML"
        break
    fi

    sleep 2
done
