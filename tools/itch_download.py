# Downloads one file from a free itch.io asset page (the "No thanks, just take me to the downloads" flow).
#   python tools/itch_download.py <page-url> <file-name-substring> <out-path>
import http.cookiejar
import json
import re
import sys
import urllib.parse
import urllib.request

page, want, out = sys.argv[1:4]
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.addheaders = [('User-Agent', 'Mozilla/5.0'), ('X-Requested-With', 'XMLHttpRequest')]


def get(url):
    return opener.open(url, timeout=60).read().decode('utf-8', 'replace')


def post(url, data):
    return opener.open(url, urllib.parse.urlencode(data).encode(), timeout=60).read().decode('utf-8', 'replace')


def csrf(html):
    return re.search(r'name="csrf_token" value="([^"]+)"', html).group(1)


html = get(page)
dl_page = json.loads(post(page.rstrip('/') + '/download_url', {'csrf_token': csrf(html)}))['url']
dl_html = get(dl_page)
key = urllib.parse.unquote(dl_page.rstrip('/').split('/')[-1])
upload = None
for m in re.finditer(r'data-upload_id="(\d+)"', dl_html):
    seg = dl_html[max(0, m.start() - 1500): m.start() + 1500]
    names = re.findall(r'title="([^"]+\.(?:zip|glb|fbx|rar|7z))"', seg) + re.findall(r'class="name"[^>]*>([^<]+)<', seg)
    if any(want in n for n in names):
        upload = m.group(1)
        break
if not upload:
    print('Files on page:', re.findall(r'title="([^"]+\.zip)"', dl_html))
    sys.exit('No matching file for ' + want)
file_url = json.loads(post(f"{page.rstrip('/')}/file/{upload}?source=view_game&as_props=1&after_download_lightbox=true", {'csrf_token': csrf(html)}))['url']
print('Downloading', want, 'upload', upload)
with opener.open(file_url, timeout=900) as r, open(out, 'wb') as f:
    while chunk := r.read(1 << 20):
        f.write(chunk)
print('Saved', out)
