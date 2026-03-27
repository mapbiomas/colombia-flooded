/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 04: MULTI-THRESHOLD HAND SPATIAL FILTER
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Applies per-polygon HAND (Height Above Nearest Drainage) masks
 *                followed by a spatial connectivity filter. Each polygon set
 *                defines an independent HAND threshold: flooded pixels (6) above
 *                the threshold within that polygon are reclassified to 27.
 *                An unconditional removal polygon (remove) forces class 6 → 27
 *                regardless of HAND, and a reverse polygon (add) forces class
 *                27 → 6. Water-body pixels are excluded from slope masking.
 *                After all terrain masks, a connectedPixelCount + focal_mode
 *                spatial filter removes isolated groups (< minConnectedPixels).
 *                Missing year bands are filled with 27 before filtering using
 *                a remap([0,6],[27,6],27). Polygon sets that are not imported
 *                in the Code Editor are safely ignored (typeof guards).
 * @inputs        - Classification (clasificacion-ft/)
 * @outputs       - Earth Engine Asset: HAND+spatially filtered classification
 *                  image saved to 'COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
 * @geom_struct   HAND POLYGON SETS (import as FeatureCollections in Code Editor):
 *                Each feature must contain a 'value' property = 1.
 *                - geometry_remap_estricto : HAND >= 10  → reclassify 6 to 27
 *                - Remap2                 : HAND >= 21  → reclassify 6 to 27
 *                - Remap3                 : HAND >= 16  → reclassify 6 to 27
 *                - Remap4                 : HAND >= 12  → reclassify 6 to 27
 *                - Remap5                 : HAND >= 6   → reclassify 6 to 27
 *                - Remap7                 : HAND >= 4   → reclassify 6 to 27
 *                - Borrar                 : unconditional → reclassify 6 to 27
 *                - Remap_6                : reverse      → reclassify 27 to 6
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:         30208,
  country:            'COLOMBIA',
  inputCollection:    'clasificacion-ft',
  minConnectedPixels: 200,
  eightConnected:     true,
  previewYears:       [1993, 2023],
  versionInput:       '4',
  versionOutput:      '5',
  handPolygons: {
    hand10: typeof geometry_remap_estricto !== 'undefined' ? geometry_remap_estricto : null,
    hand21: typeof Remap2 !== 'undefined' ? Remap2 : null,
    hand16: typeof Remap3 !== 'undefined' ? Remap3 : null,
    hand12: typeof Remap4 !== 'undefined' ? Remap4 : null,
    hand6:  typeof Remap5 !== 'undefined' ? Remap5 : null,
    hand4:  typeof Remap7 !== 'undefined' ? Remap7 : null,
    remove: typeof Borrar  !== 'undefined' ? Borrar  : null,
    add:    typeof Remap_6 !== 'undefined' ? Remap_6 : null
  }
};

var classId = 6;

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';

var assets = {
  regionsWetland:   basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/WETLANDS/ClasificacionRegionesInundables2024C2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  waterBodies:      'projects/mapbiomas-colombia/assets/MAPBIOMAS-WATER/COLECCION2/COLOMBIA/DATOS-AUXILIARES/RASTER/cuerpos_agua_carto_base',
  handRaster:       'users/gena/GlobalHAND/30m/hand-1000',
  inputPath:        basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/' + param.inputCollection + '/',
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region  = getRegion(assets.regionsWetland, param.regionCode);
var mosaics = getMosaic(region.vector);

var years = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996,
  1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008,
  2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024, 2025
];

var bandNames = ee.List(years.map(function(year) {
  return 'classification_' + String(year);
}));

var inputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionInput;
var classification = ee.Image(assets.inputPath + inputImageName);
print('Input image:', classification);

// ==============================================================================
// 4. PROCESSING
// ==============================================================================

// Strip constant band if present; mask zero-value pixels
var bandnameReg = classification.bandNames();
var bands = bandnameReg.getInfo();
if (bands[0] === 'constant') {
  bands = bands.slice(1);
}

var classif = ee.Image();
bands.forEach(function(bandName) {
  var imagey = classification.select(bandName);
  var band0  = imagey.updateMask(imagey.unmask().neq(0));
  classif = classif.addBands(band0.rename(bandName));
});

var image = classif.select(bands).unmask().updateMask(region.rasterMask);

// Fill missing year bands with 27 (non-flooded) using frequency histogram
var bandsOccurrence = ee.Dictionary(
  bandNames.cat(image.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      image.select([key]),
      ee.Image(27).rename([key])
    )
  ).byte();
});

var allBandsImage = ee.Image(
  bandNames.iterate(
    function(band, img) {
      var newBand = ee.Image(bandsDictionary.get(ee.String(band)))
        .remap([0, classId], [27, classId], 27)
        .rename(ee.String(band));
      return ee.Image(img).addBands(newBand).updateMask(region.rasterMask);
    },
    ee.Image().select()
  )
);

// Save pre-HAND-mask image for visualization
var allBandsPreHand = allBandsImage;

// HAND raster and water-body mask
var notWater    = ee.Image(assets.waterBodies).unmask().eq(0);
var hand30_1000 = ee.Image(assets.handRaster);

// Build per-polygon HAND threshold rasters (ee.Image(0) when polygon not imported)
function toRaster(fc) {
  return fc
    ? fc.reduceToImage({ properties: ['value'], reducer: ee.Reducer.first() })
    : ee.Image(0);
}

var rasterHand10 = toRaster(param.handPolygons.hand10);
var rasterHand21 = toRaster(param.handPolygons.hand21);
var rasterHand16 = toRaster(param.handPolygons.hand16);
var rasterHand12 = toRaster(param.handPolygons.hand12);
var rasterHand6  = toRaster(param.handPolygons.hand6);
var rasterHand4  = toRaster(param.handPolygons.hand4);
var rasterRemove = toRaster(param.handPolygons.remove);
var rasterAdd    = toRaster(param.handPolygons.add);

// Apply multi-threshold HAND masks and unconditional remap polygons
allBandsImage = allBandsImage
  .where(hand30_1000.gte(21).and(allBandsImage.eq(classId)).and(rasterHand21.eq(1)), 27)
  .where(hand30_1000.gte(16).and(allBandsImage.eq(classId)).and(rasterHand16.eq(1)), 27)
  .where(hand30_1000.gte(12).and(allBandsImage.eq(classId)).and(rasterHand12.eq(1)), 27)
  .where(hand30_1000.gte(10).and(allBandsImage.eq(classId)).and(rasterHand10.eq(1)), 27)
  .where(hand30_1000.gte(6).and(allBandsImage.eq(classId)).and(rasterHand6.eq(1)),  27)
  .where(hand30_1000.gte(4).and(allBandsImage.eq(classId)).and(rasterHand4.eq(1)),  27)
  .where(allBandsImage.eq(classId).and(rasterRemove.eq(1)), 27)
  .where(allBandsImage.eq(27).and(rasterAdd.eq(1)), classId);

// Compute connected pixel counts for spatial filtering
var imageWithCounts = allBandsImage.addBands(
  allBandsImage.connectedPixelCount(100, param.eightConnected)
    .rename(bandNames.map(function(band) {
      return ee.String(band).cat('_connected');
    }))
);

var filteredImage = ee.Image(0).updateMask(region.rasterMask);

years.forEach(function(year) {
  var bandName  = 'classification_' + year;
  var bandConn  = bandName + '_connected';
  var imageBand = imageWithCounts.select(bandName);
  var connected = imageWithCounts.select(bandConn);

  var moda = imageBand
    .focal_mode(1, 'square', 'pixels')
    .mask(connected.lte(param.minConnectedPixels));

  var classOut = imageBand.blend(moda);
  filteredImage = filteredImage.addBands(classOut);
});

filteredImage = filteredImage.select(bandNames).updateMask(region.rasterMask);

var reprojected = filteredImage.reproject({ crs: 'EPSG:4326', scale: 30 });

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

filteredImage = filteredImage.select(bandNames)
  .set({
    code_region: param.regionCode,
    country:     param.country,
    version:     param.versionOutput,
    process:     'hand spatial filter',
    step:        'S04'
  });

print('INPUT: ' + inputImageName, classification);
print('OUTPUT: ' + outputImageName, filteredImage);

Export.image.toAsset({
  image:            filteredImage,
  description:      outputImageName,
  assetId:          assets.outputAsset + outputImageName,
  pyramidingPolicy: { '.default': 'mode' },
  region:           region.vector.geometry().bounds(),
  scale:            30,
  maxPixels:        1e13
});

// ==============================================================================
// 6. VISUALIZATION
// ==============================================================================

Map.setOptions('SATELLITE');

param.previewYears.forEach(function(year) {
  var selector = 'classification_' + year;
  var vis = {
    bands: [selector], min: 0, max: mapbiomasPalette.length - 1,
    palette: mapbiomasPalette, format: 'png'
  };

  var mosaicYear = mosaics.filter(ee.Filter.eq('year', year))
    .mosaic().clip(region.vector);
  Map.addLayer(mosaicYear, {
    bands: ['swir1_median', 'nir_median', 'red_median'],
    gain: [0.08, 0.06, 0.2], gamma: 0.65
  }, 'Mosaic ' + year, false);

  Map.addLayer(allBandsPreHand.select(selector), vis, 'ClasOriginal ' + year, false);
  Map.addLayer(allBandsImage.select(selector),   vis, 'ClasHand '     + year, false);
  Map.addLayer(reprojected.select(selector),     vis, 'ClasFiltrada ' + year);
});

Map.addLayer(
  hand30_1000.clip(region.vector),
  { min: 0, max: 50, palette: ['023858', '1a9850', 'ffffbf', 'd73027'] },
  'HAND 30m', false
);
Map.addLayer(region.vector.style({ color: 'ffffff', fillColor: 'ff000000' }), {}, 'Region');

Map.add(ui.Label('Flooded Col3 - HAND Spatial Filter - Region ' + param.regionCode, {
  stretch: 'horizontal', textAlign: 'center', fontWeight: 'bold', fontSize: '10px'
}));

// ==============================================================================
// FUNCTIONS
// ==============================================================================

/**
 * Generates the region of interest vector and raster mask.
 */
function getRegion(regionPath, regionCode) {
  var regionData = ee.FeatureCollection(regionPath)
    .filter(ee.Filter.eq('id_regionC', regionCode));
  var regionMask = regionData
    .map(function(item) { return item.set('version', 1); })
    .reduceToImage(['version'], ee.Reducer.first());
  return { vector: regionData, rasterMask: regionMask };
}

/**
 * Retrieves and clips image mosaics to the region of interest.
 */
function getMosaic(regionObj) {
  var mosaicsColPaths = [
    'projects/mapbiomas-colombia/assets/MOSAICOS/mosaics-3-ct',
    'projects/mapbiomas-raisg/MOSAICOS/mosaics-6',
    'projects/mapbiomas-colombia/assets/MOSAICOS/mosaics-3',
    'projects/mapbiomas-raisg/MOSAICOS/col-amazonia-pathrow'
  ];

  var mergedMosaics = ee.ImageCollection(mosaicsColPaths[0])
    .merge(ee.ImageCollection(mosaicsColPaths[1]))
    .merge(ee.ImageCollection(mosaicsColPaths[2]))
    .merge(ee.ImageCollection(mosaicsColPaths[3]))
    .filter(ee.Filter.eq('country', 'COLOMBIA'));

  var regionMosaics = ee.FeatureCollection(assets.regionesMosaicos);

  return mergedMosaics.filterBounds(regionObj).map(function(img) {
    return img
      .clip(regionMosaics.filter(ee.Filter.eq('id_region', img.get('region_code'))))
      .clip(regionObj);
  });
}
