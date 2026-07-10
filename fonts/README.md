# Bundled fonts

`DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` are the [DejaVu fonts](https://dejavu-fonts.github.io/),
bundled so the share-card renderer (`app.py::_share_card_png`) draws identical,
deterministic text on Vercel/Lambda and locally (the runtime does not reliably
ship system fonts). DejaVu is distributed under a permissive free license
(Bitstream Vera + Arev), which allows redistribution.
