UI decision logic

The forecast dashboard calculates practical guidance from the existing forecast data instead of showing static resort text.

Inputs used:
- Resorts and elevations from the forecast JSON data
- Daily snow, rain, temperature, and wind values
- Snow conditions when present
- OpenWeather fields when present
- Extended forecast when present
- Multi-model consensus fields when present

Elevation scoring:
- More forecast snow raises the score
- Extended forecast snow gives a smaller boost
- Snow-friendly temperatures improve the score
- Warm temperatures reduce the score
- Rain and stronger wind reduce the score

Confidence:
- More loaded forecast days improve confidence
- More active source signals improve confidence
- Extended forecast days improve confidence

The result is shown as Low, Medium, or High confidence.