# Jarvis search through the ddgs library, when it is installed.
#
#   python search-ddgs.py text|news|images "<query>" <count>
#
# ddgs spreads a query over several engines (DuckDuckGo, Google, Brave,
# Mojeek, Yahoo, Wikipedia...) and talks to them with a real browser's TLS
# fingerprint, which is what keeps it from being challenged the way plain
# scripted requests are. assistant-web.js falls back to its own engines when
# Python or ddgs is missing. Prints one JSON array.
import json
import sys

def main():
    kind, query, count = sys.argv[1], sys.argv[2], int(sys.argv[3])
    from ddgs import DDGS
    d = DDGS(timeout=5)
    if kind == "news":
        rows = d.news(query, max_results=count)
    elif kind == "images":
        rows = d.images(query, max_results=count)
    else:
        rows = d.text(query, max_results=count)
    # ASCII escapes, not raw UTF-8: piped stdout on Windows is the ANSI code
    # page, which turned "·" into "�" on the way to node.
    sys.stdout.write(json.dumps(rows or []))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - reported to the caller as JSON
        sys.stdout.write(json.dumps({"error": type(e).__name__ + ": " + str(e)}))
