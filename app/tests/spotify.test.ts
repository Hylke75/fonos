// Normaliseren en scoren voor de Spotify-koppeling (pure functies, geen netwerk).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { albumIdUit, eersteArtiest, gelijkenis, normaliseer, schoonSpotifyTitel, scoreKandidaat, statusBij, uitsluitReden } from '../server/spotify/normaliseer.ts'

const album = (name: string, artiesten: string[], jaar = '1980') => ({ id: 'x'.repeat(22), name, artists: artiesten.map((n) => ({ name: n })), release_date: `${jaar}-01-01`, images: [{ url: 'https://i/640', width: 640 }, { url: 'https://i/300', width: 300 }, { url: 'https://i/64', width: 64 }] })

test('normaliseren: accenten, lidwoorden, &, toevoegingen, romeinse cijfers', () => {
  assert.equal(normaliseer('Dvořák: Symfonie nr. 9'), 'dvorak symfonie nr 9')
  assert.equal(normaliseer('The Beatles'), 'beatles')
  assert.equal(normaliseer('Simon & Garfunkel'), 'simon and garfunkel')
  assert.equal(normaliseer('Rumours [UK]'), 'rumours')
  assert.equal(normaliseer('Greatest hits [US I]'), 'greatest hits')
  assert.equal(normaliseer('Act III'), normaliseer('Act 3'))
  assert.equal(normaliseer('De Dijk'), 'dijk')
})

test('eerste artiest, zonder rol', () => {
  assert.equal(eersteArtiest(['The Beatles', 'Tony Sheridan']), 'The Beatles')
  assert.equal(eersteArtiest('Jules Massenet (Componist), Henry Lewis'), 'Jules Massenet')
  assert.equal(eersteArtiest([]), '')
})

test('Spotify-titels zonder Remastered, Deluxe, Expanded, Edition', () => {
  assert.equal(schoonSpotifyTitel('Rumours (Super Deluxe)'), 'Rumours')
  assert.equal(schoonSpotifyTitel('Abbey Road (Remastered 2009)'), 'Abbey Road')
  assert.equal(schoonSpotifyTitel('Thriller - 25th Anniversary Edition'), 'Thriller')
  assert.equal(schoonSpotifyTitel('Live (At The BBC)'), 'Live (At The BBC)')
})

test('scoren en status: goede treffer, twijfel en de valse treffers uit de proef', () => {
  const goed = scoreKandidaat('Fleetwood Mac', 'Rumours', album('Rumours (Super Deluxe)', ['Fleetwood Mac'], '1977'))
  assert.equal(statusBij(goed), 'auto_goed')
  assert.equal(goed.jaar, 1977)
  assert.equal(goed.cover, 'https://i/300')
  // "The Commodores – United" → "US Navy Commodores Jazz Ensemble": artiest te zwak, nooit automatisch goed.
  const navy = scoreKandidaat('The Commodores', 'United', album('United', ['US Navy Commodores Jazz Ensemble']))
  assert.notEqual(statusBij(navy), 'auto_goed')
  // "Dancing – Greatest hits" → ABBA-tributealbum: geen automatische koppeling.
  const abba = scoreKandidaat('Dancing', 'Greatest hits', album('Greatest Hits of ABBA', ['Dancing Queen Tribute Band']))
  assert.notEqual(statusBij(abba), 'auto_goed')
  // Juiste artiest, afwijkende titel: twijfel of geen, niet goed.
  const anders = scoreKandidaat('The Beatles', 'Live! Starclub, Hamburg 1962 ; vol.2', album('Live! At The Star-Club In Hamburg, Germany; 1962', ['The Beatles']))
  assert.notEqual(statusBij(anders), 'auto_goed')
  assert.equal(statusBij(undefined), 'geen')
  assert.ok(gelijkenis('miles davis', 'miles davis') === 1)
})

test('album-ID uit link, URI of los ID', () => {
  const id = '4LH4d3cOWNNsVw41Gqt2kv'
  assert.equal(albumIdUit(`https://open.spotify.com/album/${id}?si=abc`), id)
  assert.equal(albumIdUit(`https://open.spotify.com/intl-nl/album/${id}`), id)
  assert.equal(albumIdUit(`spotify:album:${id}`), id)
  assert.equal(albumIdUit(id), id)
  assert.equal(albumIdUit('https://open.spotify.com/track/4LH4d3cOWNNsVw41Gqt2kv'), null)
  assert.equal(albumIdUit('onzin'), null)
})

test('uitsluiten: geen artiest, generiek, klassiek', () => {
  const g = ['Reggae', 'Geluidseffecten', 'Disco Samba']
  const k = ['Orkest & symfonie', 'Opera']
  const t = (artiesten: string[], titel = 'Album', genres = ['Pop'], soort = 'populair') => uitsluitReden({ artiesten, titel, genres, soort }, g, k)
  assert.equal(t([]), 'geen artiest')
  assert.equal(t(['Diverse artiesten']), 'geen artiest')
  assert.equal(t(['Geluidseffecten']), 'generieke artiest')
  assert.equal(t(['Karajan'], 'Album', ['Pop'], 'klassiek'), 'klassiek')
  assert.equal(t(['Karajan'], 'Album', []), 'klassiek (geen genre)')
  assert.equal(t(['Karajan'], 'Album', ['Opera']), 'klassiek (genre)')
  assert.equal(t(['Karajan'], 'Symfonie nr. 5/Berliner Philharmoniker/Karajan'), 'klassiek (werk/orkest/dirigent)')
  assert.equal(t(['Fleetwood Mac'], 'Rumours'), null)
})
