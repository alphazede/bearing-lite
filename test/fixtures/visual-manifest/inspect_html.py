"""Read a local HTML projection without executing it or loading resources."""

import json
import sys
from html.parser import HTMLParser


class Projection(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.rows = []
        self.text = []
        self.scripts = []
        self.row = None
        self.cell = None
        self.script = None
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        # HTML tokenization retains the first occurrence of an attribute.
        attrs = dict(reversed(attrs))
        self.elements.append({"tag": tag, "attrs": attrs})
        if tag == "tr":
            self.row = {"cells": [], "links": [], "ids": []}
            self.rows.append(self.row)
        if self.row is not None:
            if "id" in attrs:
                self.row["ids"].append(attrs["id"])
            if tag == "a" and "href" in attrs:
                self.row["links"].append(attrs["href"])
            if tag in ("td", "th"):
                self.cell = []
        if tag == "script":
            self.script = {"attrs": attrs, "text": ""}
            self.scripts.append(self.script)
        if tag == "style":
            self.in_style = True

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row["cells"].append(" ".join("".join(self.cell).split()))
            self.cell = None
        if tag == "tr":
            self.row = None
        if tag == "script":
            self.script = None
        if tag == "style":
            self.in_style = False

    def handle_data(self, text):
        if self.script is not None:
            self.script["text"] += text
        elif not self.in_style:
            self.text.append(text)
            if self.cell is not None:
                self.cell.append(text)


parser = Projection()
parser.feed(sys.stdin.read())
parser.close()
json.dump(
    {
        "text": " ".join(parser.text),
        "rows": parser.rows,
        "elements": parser.elements,
        "scripts": parser.scripts,
    },
    sys.stdout,
)
