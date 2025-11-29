#!/usr/bin/env python3
"""Test scraping Val Thorens official website"""

import requests
from bs4 import BeautifulSoup
import time

# Try English version
url = 'https://www.valthorens.com/en/infos-neige/'
headers = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.9,he;q=0.8',
    'cache-control': 'no-cache',
    'dnt': '1',
    'pragma': 'no-cache',
    'priority': 'u=0, i',
    'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
}

cookies = {
    'pll_language': 'fr',
    '_fbp': 'fb.1.1761299461842.1785143081',
    'axeptio_cookies': '{"$$token":"123upnwhm5wll7is3uy84c","$$date":"2025-10-28T12:39:46.128Z","$$cookiesVersion":{"name":"valthorens - iris-base","identifier":"64cd07d255eec5f0279f58a1"},"google_analytics":true,"hotjar":true,"facebook_pixel":true,"google_ads":true,"Google_Ads":true,"$$scope":"persistent","$$duration":190,"$$completed":true}',
    'axeptio_authorized_vendors': ',google_analytics,hotjar,facebook_pixel,google_ads,Google_Ads,',
    'axeptio_all_vendors': ',google_analytics,hotjar,facebook_pixel,google_ads,Google_Ads,',
    '_gcl_au': '1.1.454768313.1761655186',
    '_ga': 'GA1.1.200884702.1761641214',
    'FPID': 'FPID2.2.ymvGbcxik+IHu79Nx2iGfg09G8vXRdG2Osr4JJCuaZA=.1761641214',
    'FPAU': '1.1.454768313.1761655186',
    '_hjSessionUser_2762650': 'eyJpZCI6Ijk1OGE5ZmMyLTY1YzAtNWYyOC04NDQ4LTQ0YmQ0ZGFiZmM4ZiIsImNyZWF0ZWQiOjE3NjM0NjYzMzA0ODgsImV4aXN0aW5nIjp0cnVlfQ==',
    'iris_eco_config': '{"isEcoModeActive":false,"isEcoBarHidden":true}',
    '_ga_2H0WT8YMRH': 'GS2.1.s1763466323$o1$g1$t1763466661$j60$l0$h0',
    'wp_etourisme_session': '514ea2f17a10a19ced10a59aa9121682',
    'FPLC': 'jVuUxKpPKtUDmyzeInSnystM/gbelmzycWCtmd5g3xJSw4rFkM+Be/FKUSAGA2o9P0fDhjBrqw+XGMhHQli8xh5k3E43Cc6R2P6s9fOIqIyLbxPKCNmm4SHpWD3fSchw==',
    'cf_clearance': 'UIpX7ooTMzdSHFZ38XbBp6zSx45zq7GDAsMmudrlgLY-1763803831-1.2.1.1-ib_IQgCZPAuW09DtpD1weY5ylEk6Mw9s9MdZxAiviGiRGQUKsWBnPlQLgOT6GN72ZWqkOy.6AZt.bdesN3Z7pm4P9tNfIS6ASSWwpuHWyIstboLBH8bah1M1dg40dvBCioPJSbad1BDyxQ3.Q_JfINrFwMLnkTeN0Xmy7lEQ.J0IzXGNeCPJG7Zn.pQ1pBimfx_FUtPXiiU2isEmQuxdhRONP95kN15YkdQNeDqlYDA',
    'notif_cookie_21508': 'true',
    'iris-cookie-recently-consulted': '6952,334,732',
    'FPGSID': '1.1763803831.1763804136.G-N6X018YPFS._8NSkPRsz9JGpqDK7X3yRw',
    '_ga_N6X018YPFS': 'GS2.1.s1763803831$o5$g1$t1763804136$j59$l0$h2081066852',
    '_uetsid': 'e3fbe600c78511f0af49add9c39d3f83|1q9r3dt|2|g18|0|2152',
    '_uetvid': '88f9c1c0a69e11f09e8df12690b47372|1ccz5gg|1763804137214|3|1|bat.bing.com/p/insights/c/h'
}

print("Fetching Val Thorens snow info...")
response = requests.get(url, headers=headers, cookies=cookies, timeout=30)
print(f"Status code: {response.status_code}")
print(f"Content length: {len(response.content)}")

soup = BeautifulSoup(response.content, 'html.parser')

# Save HTML to file for inspection
with open('vt_page.html', 'w', encoding='utf-8') as f:
    f.write(soup.prettify())
print("Saved HTML to vt_page.html")

# Look for snow info sections
print("\n=== Looking for snow info ===")

# Try different selectors
selectors = [
    ('div.snow-info', 'Snow info div'),
    ('table', 'Tables'),
    ('div[class*="neige"]', 'Neige divs'),
    ('div[class*="snow"]', 'Snow divs'),
    ('div[id*="neige"]', 'Neige IDs'),
    ('div[id*="snow"]', 'Snow IDs'),
]

for selector, desc in selectors:
    elements = soup.select(selector)
    if elements:
        print(f"\n{desc} ({selector}): Found {len(elements)}")
        for i, elem in enumerate(elements[:3]):  # Show first 3
            print(f"  [{i}] {elem.get('class', '')} {elem.get('id', '')}")
            text = elem.get_text(strip=True)[:200]
            print(f"      Text: {text}")

# Look for specific text patterns
print("\n=== Looking for specific patterns ===")
patterns = ['cm', 'température', 'hauteur', 'enneigement', 'qualité']
for pattern in patterns:
    found = soup.find_all(string=lambda text: text and pattern in text.lower())
    if found:
        print(f"\nPattern '{pattern}': {len(found)} matches")
        for match in found[:5]:
            print(f"  - {match.strip()[:100]}")
