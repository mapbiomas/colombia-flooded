/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 03: RANDOM FOREST CLASSIFICATION
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Runs a per-year Random Forest classification for the flooded
 *                class (6) using training samples from STEP 2. Supports
 *                additional stable and non-stable polygon samples, year-range
 *                exclusion masks, and classification area editing via
 *                inclusion/exclusion geometries.
 * @inputs        - Training samples FeatureCollection (FLOODED/SAMPLES/)
 *                - Classification mask ROI (STEP1_REGIONS/classification_mask/)
 * @outputs       - Earth Engine Asset: multi-band classification image
 *                  saved to 'FLOODED/clasificacion/'
 * @geom_struct   ADDITIONAL SAMPLES (ID_AGUA, ID27_AGR, M6_MORICHAL, ID_27_Bosque):
 *                FeatureCollections imported in the Code Editor.
 *                NON-STABLE SAMPLES (ID6_85_90, ID27_85_90):
 *                FeatureCollections imported in the Code Editor.
 *                Features must have 't0' (start year) and 't1' (end year) properties.
 *                INCLUSION / EXCLUSION (inclusion, exclusion):
 *                FeatureCollections imported in the Code Editor.
 *                Features must have a 'value' property = 1.
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:     30430,
  country:        'COLOMBIA',
  floodedClassId: 6,
  trees:          50,
  tileScale:      8,
  previewYears:   [2000, 2018, 2020, 2021, 2025],
  printResults:   true,
  versionInput:   '1',   // Training samples version (from STEP 2)
  versionOutput:  '1',   // Classification output version
  classificationArea: {
    versionROI: '1',
    inclusion:  typeof inclusion !== 'undefined' ? inclusion : ee.FeatureCollection([]),
    exclusion:  typeof exclusion !== 'undefined' ? exclusion : ee.FeatureCollection([])
  },
  additionalSamples: {
    polygons: [
              ID27,
              ID11,
              ID6,
              ID27_Plantaciones
    ],
    classes: [27,
              27,
              6,
              27],   // Class ID per polygon (same order)
    points:  [
            250,
            300,
            1100,
            400 ]
  },
  additionalSamplesNoStable: {
    polygons: [
      typeof ID6_85_90  !== 'undefined' ? ID6_85_90  : null,
      typeof ID27_85_90 !== 'undefined' ? ID27_85_90 : null
    ].filter(function(r) { return r !== null; })
    // Features must have 't0' and 't1' year range properties
  },
  exclusionRanges: [
    // typeof exclusion_2021 !== 'undefined' ? exclusion_2021 : null
  ].filter(function(r) { return r !== null; })
};

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';

var assets = {
  regions:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/WETLANDS/ClasificacionRegionesInundables2024C2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  maskROI:          basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/STEP1_REGIONS/classification_mask/FLOODED-ROI-' +
                    param.country + '-' + param.regionCode + '-' + param.classificationArea.versionROI,
  samplesPath:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/SAMPLES/',
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region = getRegion(assets.regions, param.regionCode);
var mosaics = getMosaic(region.vector);

var classArea = ee.Image(assets.maskROI).updateMask(region.rasterMask);
classArea = applyIncludeExclude(
  classArea,
  param.classificationArea.inclusion,
  param.classificationArea.exclusion
);

var samplesName     = 'samples-FLOODED-' + param.country + '-' + param.regionCode + '-' + param.versionInput;
var trainingSamples = ee.FeatureCollection(assets.samplesPath + samplesName);

var classifier = ee.Classifier.smileRandomForest({
  numberOfTrees:     param.trees,
  variablesPerSplit: 1
});

var dem       = ee.Image('JAXA/ALOS/AW3D30_V1_1').select('AVE');
var slope     = ee.Terrain.slope(dem).rename('slope');
var slppost   = ee.Image('projects/mapbiomas-raisg/MOSAICOS/slppost2_30_v1').rename('slppost');
var shadeMask2 = ee.Image('projects/mapbiomas-raisg/MOSAICOS/shademask2_v1').rename('shade_mask2');

// Region geometry raster — used to exclude stable-sample points inside additional polygons
var geomMask = ee.FeatureCollection([region.vector.geometry().bounds()])
  .map(function(item) { return item.set('version', 1); })
  .reduceToImage(['version'], ee.Reducer.first());

// Non-stable sample year range
var regionsNoStable = param.additionalSamplesNoStable.polygons.length > 0
  ? ee.FeatureCollection(param.additionalSamplesNoStable.polygons).flatten()
  : null;

var noStableYearStart = regionsNoStable ? regionsNoStable.aggregate_min('t0').getInfo() : null;
var noStableYearEnd   = regionsNoStable ? regionsNoStable.aggregate_max('t1').getInfo() : null;

// Exclusion year-range masks
var exclusionStartMask, exclusionEndMask;
if (param.exclusionRanges.length > 0) {
  var allExclusionAreas = ee.FeatureCollection(param.exclusionRanges)
    .flatten()
    .map(function(fea) { return fea.union(fea); });

  exclusionStartMask = allExclusionAreas
    .reduceToImage(['t0'], ee.Reducer.min())
    .clipToBoundsAndScale({ geometry: allExclusionAreas.geometry(), scale: 30 });

  exclusionEndMask = allExclusionAreas
    .reduceToImage(['t1'], ee.Reducer.max())
    .clipToBoundsAndScale({ geometry: allExclusionAreas.geometry(), scale: 30 });
}

var featureSpace = [
  'blue_median',   'cai_median',    'cloud_median',
  'evi2_amp',      'evi2_median',   'evi2_stdDev',
  'gcvi_median',   'green_median',  'green_min',
  'gv_median',     'gv_stdDev',     'gvs_median',
  'gvs_stdDev',    'hallcover_median',
  'ndfi_amp',      'ndfi_median',   'ndfi_stdDev',
  'ndvi_amp',      'ndvi_median',   'ndvi_stdDev',
  'nir_median',    'nir_min',       'nir_stdDev',
  'npv_median',    'npv_stdDev',    'pri_median',
  'red_median',    'red_min',       'savi_median',
  'savi_stdDev',   'sefi_median',   'sefi_stdDev',
  'shade_median',  'soil_amp',      'soil_median',
  'soil_stdDev',   'swir1_median',  'swir1_min',
  'swir2_median',  'swir2_min',     'wefi_amp',
  'wefi_stdDev'
];

var years = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992,
  1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000,
  2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008,
  2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016,
  2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024,
  2025
];

var palsarMosaics = ee.ImageCollection('JAXA/ALOS/PALSAR/YEARLY/SAR_EPOCH').select(['HH', 'HV']);

// ==============================================================================
// 4. CLASSIFICATION
// ==============================================================================

var classifiedImage = ee.Image().byte();

years.forEach(function(year) {

  var yearMosaic = mosaics
    .filter(ee.Filter.eq('year', year))
    .filterBounds(region.vector)
    .map(tasseledCap)
    .median()
    .addBands(dem.rename('elevation'))
    .addBands(slope)
    .addBands(slppost)
    .addBands(shadeMask2)
    .updateMask(region.rasterMask);

  yearMosaic = getMmri(yearMosaic);
  yearMosaic = getClay(yearMosaic);
  yearMosaic = getBai(yearMosaic);

  var yearMosaicSel = yearMosaic
    .select(featureSpace)
    .updateMask(yearMosaic.select('blue_median'))
    .updateMask(classArea);

  // Training samples for this year
  var yearSamples = trainingSamples
    .filter(ee.Filter.eq('year', year))
    .map(function(feature) { return removeProperty(feature, 'year'); });

  // Additional stable samples from user-defined polygons
  if (param.additionalSamples.polygons.length > 0) {

    var insidePolygons = ee.FeatureCollection(param.additionalSamples.polygons)
      .flatten()
      .reduceToImage(['id'], ee.Reducer.first());

    var outsidePolygons = insidePolygons.mask().eq(0).selfMask();
    outsidePolygons = geomMask.updateMask(outsidePolygons);

    var outsideVector = outsidePolygons.reduceToVectors({
      reducer:   ee.Reducer.countEvery(),
      geometry:  region.vector.geometry().bounds(),
      scale:     30,
      maxPixels: 1e13
    });

    var newSamples = resampleCover(yearMosaicSel, param.additionalSamples);
    yearSamples = yearSamples.filterBounds(outsideVector).merge(newSamples);
  }

  // Additional non-stable samples for specific year ranges
  if (regionsNoStable && year >= noStableYearStart && year <= noStableYearEnd) {
    var polygonsThisYear = regionsNoStable
      .filterBounds(region.vector)
      .filter(ee.Filter.and(
        ee.Filter.lte('t0', year),
        ee.Filter.gte('t1', year)
      ));

    var newNoStableSamples = yearMosaicSel.sampleRegions(polygonsThisYear, ['reference'], 30, null, 4);
    yearSamples = yearSamples.merge(newNoStableSamples);
  }

  var classified = classifyRandomForest(yearMosaicSel, classifier, yearSamples, param.floodedClassId);
  var bandName   = 'classification_' + year;

  // Apply year-range exclusion mask
  if (param.exclusionRanges.length > 0) {
    classified = classified.where(
      exclusionStartMask.lte(year).and(exclusionEndMask.gte(year)),
      27
    );
  }

  classifiedImage = classifiedImage.addBands(classified.rename(bandName));

  if (param.previewYears.indexOf(year) > -1) {
    if (year >= 2015 && year < 2024) {
      Map.addLayer(
        palsarMosaics.filterDate(year + '-01-01', year + '-12-30').median().updateMask(region.rasterMask),
        { bands: ['HV', 'HH', 'HV'], min: 500, max: 1e4 },
        'PALSAR ' + year, false
      );
    }
    Map.addLayer(yearMosaic, { bands: ['swir1_median', 'nir_median', 'red_median'], min: 100, max: 4500 }, 'Mosaic Green ' + year, false);
    Map.addLayer(yearMosaic, { bands: ['nir_median', 'swir1_median', 'red_median'], gain: [0.06, 0.08, 0.2] },  'Mosaic Red ' + year, false);
    Map.addLayer(yearMosaic, { bands: ['brightness'], min: 2000, max: 3500 },      'Brightness ' + year, false);
    Map.addLayer(yearMosaic, { bands: ['clay_median'], min: 300, max: 390 },        'Clay ' + year, false);
    Map.addLayer(yearMosaic, { bands: ['wetness'], min: -200, max: 280, palette: ['1218c8', '3aa1d2', 'ffedc6', '2c8d46', 'ff0000'] }, 'Wetness ' + year, false);
    Map.addLayer(
      classified.rename(bandName).updateMask(classArea),
      { min: 0, max: mapbiomasPalette.length - 1, palette: mapbiomasPalette },
      'Classification ' + year, false
    );
  }
});

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputName = 'FLOODED-' + param.country + '-' + param.regionCode + '-RF-' + param.versionOutput;

classifiedImage = classifiedImage.slice(1).updateMask(classArea).byte()
  .set({
    code_region: param.regionCode,
    country:     param.country,
    method:      'Random Forest',
    version:     param.versionOutput
  });

if (param.printResults) print('Output Image:', classifiedImage);

Export.image.toAsset({
  image:            classifiedImage,
  description:      outputName,
  assetId:          assets.outputAsset + outputName,
  region:           region.vector.geometry().bounds(),
  scale:            30,
  maxPixels:        1e13,
  pyramidingPolicy: { '.default': 'mode' }
});

// ==============================================================================
// 6. VISUALIZATION
// ==============================================================================

Map.setOptions('SATELLITE');

var uso18       = ee.Image('projects/ee-kahuertas/assets/usocor18');
var wetlandClc  = ee.Image('users/mapbiomas_c1/Inundables/wetland_clc_2018');
var humedalesCol = ee.Image('users/mapbiomasdesarrollo/Colombia_C2/Datos_Auxiliares/Raster/RasterHumedales2024');

Map.addLayer(classArea.updateMask(classArea), { palette: ['fcff00'] }, 'Classification area (ROI)', false);
Map.addLayer(uso18.clip(region.vector).randomVisualizer(),        {}, 'Land use 2018',            false);
Map.addLayer(wetlandClc.clip(region.vector).randomVisualizer(),   {}, 'Wetland CLC 2018',         false);
Map.addLayer(humedalesCol.clip(region.vector).randomVisualizer(), {}, 'Humedales de Colombia',    false);
Map.addLayer(region.vector, {}, 'Region', true);

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

/**
 * Trains and applies a Random Forest classifier.
 * Returns class floodedClassId or 27 (non-flooded).
 */
function classifyRandomForest(mosaic, classifier, samples, floodedClassId) {
  var bands   = mosaic.bandNames();
  var nBands  = bands.size();
  var nPoints = samples.size();

  var nClassSamples = ee.List(
    samples.reduceColumns(ee.Reducer.toList(), ['reference']).get('list')
  ).reduce(ee.Reducer.countDistinct());

  var trainedClassifier = ee.Classifier(
    ee.Algorithms.If(
      ee.Algorithms.IsEqual(nBands, 0), null,
      ee.Algorithms.If(
        ee.Algorithms.IsEqual(nClassSamples, 1), null,
        classifier.train(samples, 'reference', bands)
      )
    )
  );

  var classified = ee.Image(
    ee.Algorithms.If(
      ee.Algorithms.IsEqual(nPoints, 0), ee.Image().rename('classification'),
      ee.Algorithms.If(
        ee.Algorithms.IsEqual(nBands, 0), ee.Image().rename('classification'),
        ee.Algorithms.If(
          ee.Algorithms.IsEqual(nClassSamples, 1), ee.Image().rename('classification'),
          mosaic.classify(trainedClassifier)
        )
      )
    )
  ).unmask(27).toByte();

  return classified
    .where(classified.neq(floodedClassId), 27)
    .where(classified.eq(floodedClassId), 6);
}

/**
 * Takes additional training samples from user-defined polygons.
 */
function resampleCover(mosaic, additionalSamples) {
  var newSamples = [];
  additionalSamples.polygons.forEach(function(polygon, i) {
    var sample = mosaic.sample({
      numPixels:  additionalSamples.points[i],
      region:     polygon,
      scale:      30,
      projection: 'EPSG:4326',
      seed:       1,
      geometries: true,
      tileScale:  param.tileScale
    }).map(function(item) {
      return item.set('reference', additionalSamples.classes[i]);
    });
    newSamples.push(sample);
  });
  return ee.FeatureCollection(newSamples).flatten();
}

/**
 * Applies inclusion and exclusion polygon edits to a binary mask.
 */
function applyIncludeExclude(mask, inclu, exclu) {
  var inclusionRegions = ee.FeatureCollection(inclu)
    .reduceToImage(['value'], ee.Reducer.first())
    .clipToBoundsAndScale({ geometry: ee.FeatureCollection(inclu).geometry(), scale: 30 })
    .eq(1);
  var exclusionRegions = ee.FeatureCollection(exclu)
    .reduceToImage(['value'], ee.Reducer.first())
    .clipToBoundsAndScale({ geometry: ee.FeatureCollection(exclu).geometry(), scale: 30 })
    .eq(1);
  mask = mask.where(exclusionRegions.eq(1), 0).selfMask();
  mask = ee.Image(0).where(mask.eq(1), 1).where(inclusionRegions.eq(1), 1).selfMask();
  return mask;
}

/**
 * Removes a single property from a Feature.
 */
function removeProperty(feature, property) {
  var selectProperties = feature.propertyNames()
    .filter(ee.Filter.neq('item', property));
  return feature.select(selectProperties);
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

/**
 * Computes Tasseled Cap brightness, greeness, and wetness.
 * Coefficients differ between Landsat 8 and Landsat 5/7.
 */
function tasseledCap(image) {
  var sensor = ee.String(image.get('satellite')).slice(1);

  var landsatBands = {
    BLUE:  image.select('blue_median'),
    GREEN: image.select('green_median'),
    RED:   image.select('red_median'),
    NIR:   image.select('nir_median'),
    SWIR1: image.select('swir1_median'),
    SWIR2: image.select('swir2_median')
  };

  var brightness = ee.Image(ee.Algorithms.If(
    ee.Algorithms.IsEqual(sensor, '8'),
    image.expression('(BLUE*0.3029)+(GREEN*0.2786)+(RED*0.4733)+(NIR*0.5599)+(SWIR1*0.508)+(SWIR2*0.1872)', landsatBands),
    image.expression('(BLUE*0.3037)+(GREEN*0.2793)+(RED*0.4743)+(NIR*0.5585)+(SWIR1*0.5082)+(SWIR2*0.1863)', landsatBands)
  )).rename('brightness').toInt16();

  var greeness = ee.Image(ee.Algorithms.If(
    ee.Algorithms.IsEqual(sensor, '8'),
    image.expression('-(BLUE*0.2941)-(GREEN*0.243)-(RED*0.5424)+(NIR*0.7276)+(SWIR1*0.0713)-(SWIR2*0.1608)', landsatBands),
    image.expression('-(BLUE*0.2848)-(GREEN*0.2435)-(RED*0.5436)+(NIR*0.7243)+(SWIR1*0.0840)-(SWIR2*0.1800)', landsatBands)
  )).rename('greeness').toInt16();

  var wetness = ee.Image(ee.Algorithms.If(
    ee.Algorithms.IsEqual(sensor, '8'),
    image.expression('(BLUE*0.1511)+(GREEN*0.1973)+(RED*0.3283)+(NIR*0.3407)-(SWIR1*0.7117)-(SWIR2*0.4559)', landsatBands),
    image.expression('-(BLUE*0.1509)+(GREEN*0.1973)+(RED*0.3279)+(NIR*0.3406)-(SWIR1*0.7112)-(SWIR2*0.4572)', landsatBands)
  )).rename('wetness').toInt16();

  return image.addBands(brightness).addBands(greeness).addBands(wetness);
}

/**
 * Computes MMRI: Modified Multi-band Water Index Ratio Index.
 * Requires 'mndwi_median' band (pre-computed in the mosaic collection).
 */
function getMmri(image) {
  var mmri = image.expression(
    '(MNDWI - NDVI) / (MNDWI + NDVI)',
    { MNDWI: image.select('mndwi_median'), NDVI: image.select('ndvi_median') }
  ).multiply(100).add(100).byte().rename('mmri_median');
  return image.addBands(mmri);
}

/**
 * Computes Clay index (SWIR1 / SWIR2).
 */
function getClay(image) {
  var clay = image.expression(
    '(SWIR1 / SWIR2)',
    { SWIR1: image.select('swir1_median'), SWIR2: image.select('swir2_median') }
  ).multiply(100).add(100).int16().rename('clay_median');
  return image.addBands(clay);
}

/**
 * Computes BAI: Burned Area Index.
 */
function getBai(image) {
  var bai = image.expression(
    '1 / ( ((0.1 - RED) ** 2) + ((0.06 - NIR) ** 2) )',
    { NIR: image.select('nir_median'), RED: image.select('red_median') }
  ).multiply(100).add(100).int16().rename('bai_median');
  return image.addBands(bai);
}


