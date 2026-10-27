# Third-party rights and notices

The project's PolyForm license applies only to material its contributors are entitled to license. Third-party software, data, artwork and trademarks remain subject to their respective owners' terms.

## Magic: The Gathering and playmats

Magic: The Gathering and related names, card text and artwork belong to Wizards of the Coast and/or their respective owners. Meu Magic is an unofficial fan project; it is not approved, endorsed or sponsored by Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC. See the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) and applicable terms.

The nine images in `public/playmats/` are derived from [Wizards' Lost Wallpapers](https://magic.wizards.com/en/news/feature/lost-wallpapers-2012-12-06). Their redistribution in this repository and portable app has **not been cleared**. The source and attribution do not themselves grant redistribution rights. Resolve permissions for these images, and confirm that the application and its use of Wizards material are permitted, before making this repository or its builds public.

## Card data and images

Card metadata and images are requested from [Scryfall](https://scryfall.com/) at runtime and are governed by Scryfall's [API terms and guidelines](https://scryfall.com/docs/api) and by the rights holders' terms. Card names, text and art are not relicensed by this project. Local test fixtures may contain third-party card metadata and should be included in the rights review.

The preconstructed deck manifests were derived from [MTGJSON](https://mtgjson.com/). MTGJSON distributes its software and content under the [MIT License](https://mtgjson.com/license/):

> Copyright © 2018 – Present, Zach Halpern. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

MTGJSON's license does not establish ownership of Wizards' underlying content; review the source and rights of the data independently.

## Software dependencies

The portable app includes third-party JavaScript packages, Electron and Chromium. The build collects their license and notice texts in `resources/legal` inside the extracted portable package. Electron and Chromium notices are included separately. Dependencies used only to build or test the project retain their own licenses in their package distributions.
