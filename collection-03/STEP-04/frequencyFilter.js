/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 04-5B: FREQUENCY FILTER (ADJUSTED)
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Applies a frequency filter to stabilize the flooded class (6)
 *                across the time series. Pixels classified as flooded in more
 *                than majorityPercent of included years are permanently assigned
 *                class 6. Supports year exclusions, an optional spatial area
 *                restriction (applyArea), and polygon-based class remapping.
 *                Within the applyArea, class 6 pixels that fail the frequency
 *                threshold are reassigned to 27 (non-flooded).
 * @inputs        - Classification (clasificacion-ft/)
 * @outputs       - Earth Engine Asset: frequency-filtered classification image
 *                  saved to 'COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft/'
 * @geom_struct   REMAP GEOMETRIES (remap_to_27):
 *                Each item must be a FeatureCollection imported in the Code Editor.
 *                Each feature must contain:
 *                - 'from': Comma-separated source class IDs (e.g., '6,27')
 *                - 'to':   Comma-separated target class IDs (e.g., '27,6')
 *                APPLY AREA (apply_area):
 *                A FeatureCollection imported in the Code Editor. No required properties.
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:      30430,
  country:         'COLOMBIA',
  previewYear:     2023,
  inputCollection: 'clasificacion-ft',
  versionInput:    5,
  versionOutput:   6,
  majorityPercent: 50,
  excludeYears:    [],
  remaps: [
    typeof remap_to_27 !== 'undefined' ? remap_to_27 : null
  ].filter(function(r) { return r !== null; }),
  applyArea: typeof apply_area !== 'undefined' ? apply_area : null
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

// Binary reconstruction: extract class 6 from classification within the region.
// Every pixel within region defaults to 27; class 6 pixels override.
var bandnameReg = classification.bandNames();
var bands = bandnameReg.getInfo();
if (bands[0] === 'constant') { bands = bands.slice(1); }

var classif = ee.Image(0);
bands.forEach(function(bandName) {
  var nodata = ee.Image(27);

  var newImage = ee.Image(0)
    .updateMask(region.rasterMask)
    .where(nodata.eq(27), 27)
    .where(classification.select(bandName).eq(classId), classId);

  var band0 = newImage.updateMask(newImage.unmask().neq(0));
  classif = classif.addBands(band0.rename(bandName));
});

var image = classif.select(bandnameReg);

// Fill missing year bands with masked empty bands using frequency histogram
var bandsOccurrence = ee.Dictionary(
  bandNames.cat(image.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      image.select([key]).byte(),
      ee.Image().rename([key]).byte().updateMask(image.select(0))
    )
  );
});

var imageAllBands = ee.Image(
  bandNames.iterate(
    function(band, img) {
      return ee.Image(img).addBands(bandsDictionary.get(ee.String(band)));
    },
    ee.Image().select()
  )
);

// Apply frequency filter
var filtered = frequencyFilter(classification);
var original = classification;

// Merge: use imageAllBands as spatial template; overlay frequency-filtered result
filtered = imageAllBands.select(bandNames)
  .where(imageAllBands.gte(1), filtered);

// Apply spatial area restriction
if (param.applyArea) {
  if (param.applyArea.size().getInfo() > 0) {
    var geomMask   = ee.Image().paint(param.applyArea, 1);
    var filterGeom = filtered.mask(geomMask).selfMask();
    filtered = original.where(filterGeom.and(filtered.eq(classId)), 27);
    filtered = filtered.where(filterGeom, filterGeom);
  }
}

// Apply polygon-based class remapping
if (param.remaps.length > 0) {
  var remapBands = filtered.bandNames();
  var remapped = remapBands.map(function(band) {
    return remapWithPolygons(filtered.select([band]), param.remaps).rename([band]);
  });
  filtered = ee.ImageCollection(remapped).toBands().rename(remapBands);
}

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputImageName = 'FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

filtered = filtered.select(bandNames)
  .set({
    code_region: param.regionCode,
    country:     param.country,
    version:     param.versionOutput.toString(),
    process:     'frequency filter',
    step:        'S04-5'
  });

print('INPUT: ' + inputImageName, classification);
print('OUTPUT: ' + outputImageName, filtered);

Export.image.toAsset({
  image:            filtered,
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

var vis = {
  bands: ['classification_' + param.previewYear],
  min: 0, max: mapbiomasPalette.length-1, palette: mapbiomasPalette, format: 'png'
};

var mosaicPreview = mosaics.filter(ee.Filter.eq('year', param.previewYear))
  .mosaic().updateMask(region.rasterMask);
Map.addLayer(mosaicPreview, {
  bands: ['swir1_median', 'nir_median', 'red_median'],
  gain: [0.08, 0.06, 0.08], gamma: 0.65
}, 'Mosaic ' + param.previewYear, false);

Map.addLayer(original.unmask(27).updateMask(region.rasterMask), vis, 'ClasOriginal ' + param.previewYear, false);
Map.addLayer(filtered, vis, 'ClasFiltrada ' + param.previewYear);
Map.addLayer(region.vector.style({ color: 'ffffff', fillColor: 'ff000000' }), {}, 'Region');

Map.add(ui.Label('Flooded Col3 - Frequency Filter - Region ' + param.regionCode, {
  stretch: 'horizontal', textAlign: 'center', fontWeight: 'bold', fontSize: '10px'
}));

// ==============================================================================
// FUNCTIONS
// ==============================================================================

/**
 * Applies a frequency filter: pixels classified as classId in more than
 * majorityPercent of included years are permanently assigned classId.
 */
function frequencyFilter(inputImage) {
  var imgBands = inputImage.bandNames();
  var mainImage = inputImage;

  if (param.excludeYears && param.excludeYears.length > 0) {
    var excludedBands = param.excludeYears.map(function(yr) {
      return 'classification_' + yr;
    });
    imgBands = imgBands.removeAll(excludedBands);
    inputImage = inputImage.select(imgBands);
    print('Excluded years:', param.excludeYears.join(', '));
  }

  var usedBands = imgBands.size().getInfo();

  var frequency = inputImage.eq(classId)
    .reduce('sum')
    .divide(imgBands.size())
    .multiply(100);

  var floodedMap = ee.Image(0).where(frequency.gt(param.majorityPercent), classId);
  floodedMap = floodedMap.updateMask(floodedMap.neq(0));

  var filteredImg = inputImage.where(floodedMap, floodedMap);

  if (param.excludeYears && param.excludeYears.length > 0) {
    filteredImg = filteredImg
      .addBands(mainImage.select(excludedBands))
      .select(mainImage.bandNames());
  }

  Map.addLayer(frequency, {
    min: 0, max: 100,
    palette: 'dadada,ff6f2b,97cbff,3590ff,230aff'
  }, 'Frequency of Flooded (' + usedBands + ' bands)', false);

  return filteredImg;
}

/**
 * Applies polygon-based class remapping to a single-band image.
 * Properties 'from' and 'to' are comma-separated class ID lists.
 */
function remapWithPolygons(image, polygonsList) {
  polygonsList.forEach(function(polygon) {
    var excluded = polygon.map(function(layer) {
      var area = image.clip(layer);
      var from = ee.String(layer.get('from')).split(',')
        .map(function(item) { return ee.Number.parse(item); });
      var to   = ee.String(layer.get('to')).split(',')
        .map(function(item) { return ee.Number.parse(item); });
      return area.remap(from, to).clipToBoundsAndScale({
        geometry: layer.geometry(), scale: 30
      });
    });
    excluded = ee.ImageCollection(excluded).mosaic();
    image = excluded.unmask(image).rename('classification');
    image = image.mask(image.neq(0));
  });
  return image;
}

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
