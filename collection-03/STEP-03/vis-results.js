/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 03: TIME-SERIES VISUALIZATION GRID
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Generates a multi-panel UI grid to visually validate the
 *                FLOODED classification or filtered outputs across the
 *                entire time series.
 * @inputs        - Classification ImageCollection (clasificacion/ or clasificacion-ft/)
 *                - Region vector (ClasificacionRegionesInundables2024C2)
 * @outputs       - Earth Engine UI: multi-panel interactive map grid
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:    30430,
  country:       'COLOMBIA',
  step:          'CO',   // 'CO': Original Classification | 'CF': Filtered Classification
  versionInput:  '1',    // Version of the output to load
  loadFLOODED:    true,   // If false, shows only the base mosaic without the classification mask
  columnsPerRow: 4       // Number of map columns in the UI grid
};

// Years with no mosaic will show a layer error in the map panel
// but will not stop the script from running.
var years = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992,
  1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000,
  2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008,
  2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016,
  2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024,
  2025
];

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var mapbiomasPalette = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js').get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/WETLANDS/ClasificacionRegionesInundables2024C2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  maskROI:          basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/STEP1_REGIONS/classification_mask/FLOODED-ROI-' + param.country + '-' + param.regionCode + '-' + param.versionInput,
  classifCO:        basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion',
  classifCF:        basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var regionData = ee.FeatureCollection(assets.regions)
  .filter(ee.Filter.eq('id_regionC', param.regionCode));
print('regionData',regionData)
var mosaics = getMosaic(regionData);

var vectorsROI = ee.Image(assets.maskROI).reduceToVectors({
  geometry:     regionData.geometry().bounds(),
  scale:        100,
  geometryType: 'polygon'
});

var collectionPath = param.step === 'CO' ? assets.classifCO : assets.classifCF;

var collection;
if (param.step === 'CO') {
  collection = ee.ImageCollection(collectionPath)
    .filter(ee.Filter.eq('code_region', param.regionCode))
    .filter(ee.Filter.eq('version', param.versionInput));
} else {
  collection = ee.ImageCollection(collectionPath)
    .filter(ee.Filter.neq('process', 'gapfill metadata'))
    .filter(ee.Filter.eq('code_region', param.regionCode))
    .filter(ee.Filter.eq('version', param.versionInput));
}
print('collection',collection)
// ==============================================================================
// 4. UI CONSTRUCTION
// ==============================================================================

var maps = [];

years.forEach(function(year) {
  var mosaicYearImg = mosaics.filter(ee.Filter.eq('year', year)).mean().clip(regionData);
  var mosaicClass   = collection.mosaic().select('classification_' + String(year));
  var classFLOODED   = mosaicClass.eq(6).selfMask().multiply(6);

  var map = ui.Map();
  map.setControlVisibility(false);

  map.add(ui.Label(String(year), {
    position:   'bottom-left',
    fontWeight: 'bold',
    padding:    '4px',
    margin:     '0px'
  }));

  map.addLayer(regionData, { palette: ['cccccc'], opacity: 0.6 }, 'Region', false);
  map.addLayer(mosaicYearImg, { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic ' + year, true);

  if (param.loadFLOODED) {
    map.addLayer(
      classFLOODED,
      { bands: ['classification_' + String(year)], min: 0, max: mapbiomasPalette.length-1, palette: mapbiomasPalette, format: 'png' },
      'Classification ' + year,
      true
    );
  }

  map.addLayer(vectorsROI.style({ fillColor: '00000000', color: 'red' }), {}, 'ROI Border', false);

  maps.push(map);
});

var linker = ui.Map.Linker(maps);

var titleText = (param.step === 'CO' ? 'Original' : 'Filtered') + ' FLOODED Classification Collection 3 - MapBiomas Colombia - Region ' + param.regionCode;
var title = ui.Label(titleText, {
  stretch:    'horizontal',
  textAlign:  'center',
  fontWeight: 'bold',
  fontSize:   '18px',
  padding:    '10px'
});

var gridRows = [];
for (var i = 0; i < maps.length; i += param.columnsPerRow) {
  gridRows.push(ui.Panel(maps.slice(i, i + param.columnsPerRow), ui.Panel.Layout.Flow('horizontal'), { stretch: 'both' }));
}

var mapGrid = ui.Panel(gridRows, ui.Panel.Layout.Flow('vertical'), { stretch: 'both' });

ui.root.widgets().reset([title, mapGrid]);
ui.root.setLayout(ui.Panel.Layout.Flow('vertical'));

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

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
