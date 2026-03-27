/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: FLOODED
 * STEP 08: FILTER AREA STATISTICS EXPORT
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Calculates and exports the total area (in hectares) for Class 6
 *                (FLOODED) across the RF classification (STEP-03), the join-filter
 *                baseline (STEP-04-1), and all subsequent filter versions.
 *                Compiles the results into a single CSV. The RF baseline column
 *                is optional: set versionRF to null to skip it.
 * @inputs        - RF classification ImageCollection (clasificacion/)
 *                - Filtered classification ImageCollections (clasificacion-ft/)
 *                - Region vector (ClasificacionRegionesInundables2024C2)
 * @outputs       - CSV Export to Google Drive
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:     30208,
  country:        'COLOMBIA',
  versionRF:      '2',               // RF classification version (clasificacion/); set null to skip
  versionJoin:    '11',              // Join-filter baseline version (clasificacion-ft/)
  exportFilters:  true,              // Include subsequent filter versions in the CSV?
  versionFilters: ['2','3','4','5','6'], // Filter versions to compare (clasificacion-ft/)
  previewYear:    2015               // Year to display on the map
};

// Generate List of Years
var yearsList = ee.List.sequence(1985, 2025);
var bandNames = yearsList.map(function(year){
  return ee.String('classification_').cat(ee.Number(year).format('%04d'));
});

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:        basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/WETLANDS/ClasificacionRegionesInundables2024C2',
  FLOODEDClassCO: basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion',
  FLOODEDClassFt: basePath + 'LULC/COLLECTION3/CROSS_CUTTING/FLOODED/clasificacion-ft'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

// Load Region
var regionData = ee.FeatureCollection(assets.regions)
  .filter(ee.Filter.eq('id_regionC', param.regionCode))
  .map(function(fea){ return fea.set('version', 1); });

var regionGeom = regionData.geometry();

// Load RF Classification (STEP-03) — optional baseline
var classRFImg = param.versionRF
  ? ee.ImageCollection(assets.FLOODEDClassCO)
      .filter(ee.Filter.eq('code_region', param.regionCode))
      .filter(ee.Filter.eq('version', param.versionRF))
      .select(bandNames)
      .mosaic()
  : null;

if (param.versionRF) print('RF Classification:', classRFImg);

// Load Join-Filter Baseline (STEP-04-1)
var classJoinImg = ee.ImageCollection(assets.FLOODEDClassFt)
  .filter(ee.Filter.eq('code_region', param.regionCode))
  .filter(ee.Filter.eq('version', param.versionJoin))
  .select(bandNames)
  .mosaic();

print('Join-Filter Baseline:', classJoinImg);

// Load Subsequent Filtered Classifications
var classFiltersCol = ee.ImageCollection(assets.FLOODEDClassFt)
  .filter(ee.Filter.eq('code_region', param.regionCode))
  .filter(ee.Filter.inList('version', param.versionFilters))
  .filter(ee.Filter.neq('process', 'gapfill metadata'))
  .select(bandNames);

print('Filtered Classifications Collection:', classFiltersCol);

// ==============================================================================
// 4. PARALLEL AREA CALCULATION (SERVER-SIDE)
// ==============================================================================

var statsExport;

// Extract dynamic column names (e.g., "ID6_spatial filter_2")
var filterDescriptions = classFiltersCol.aggregate_array('process');
var filterVersions     = classFiltersCol.aggregate_array('version');

var filterColumnNames = filterDescriptions.zip(filterVersions).map(function(pair) {
  var p = ee.List(pair);
  return ee.String('ID6_').cat(p.get(0)).cat('_').cat(p.get(1));
});

var filterImgList = classFiltersCol.toList(classFiltersCol.size());

// Map over each year to calculate areas efficiently
var yearlyStatsFC = ee.FeatureCollection(yearsList.map(function(year) {
  var yearStr  = ee.Number(year).format('%04d');
  var bandName = ee.String('classification_').cat(yearStr);

  var pixelAreaHectares = ee.Image.pixelArea().divide(1e4);

  function areaOf(img) {
    var dict = img.select([bandName]).eq(6)
      .multiply(pixelAreaHectares)
      .reduceRegion({
        reducer: ee.Reducer.sum(), geometry: regionGeom, scale: 30, maxPixels: 1e13
      });
    return ee.Algorithms.If(ee.Algorithms.IsEqual(dict.get(bandName), null), 0, dict.get(bandName));
  }

  // Base dictionary: year
  var statsDict = ee.Dictionary({'year': yearStr});

  // 1. RF baseline (optional)
  if (param.versionRF) {
    statsDict = statsDict.set(ee.String('ID6_rf_').cat(param.versionRF), areaOf(classRFImg));
  }

  // 2. Join-filter baseline
  statsDict = statsDict.set(ee.String('ID6_join_').cat(param.versionJoin), areaOf(classJoinImg));

  // 3. Subsequent filter versions (if enabled)
  var finalDict = ee.Algorithms.If(
    param.exportFilters,
    ee.Dictionary(function() {
      var filterAreas = filterImgList.map(function(img) {
        return areaOf(ee.Image(img));
      });
      return statsDict.combine(ee.Dictionary.fromLists(filterColumnNames, filterAreas));
    }()),
    statsDict
  );

  return ee.Feature(null, ee.Dictionary(finalDict));
}));

statsExport = yearlyStatsFC;
print('Computed Statistics FeatureCollection:', statsExport);

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var exportDescription = 'ESTADISTICAS-FLOODED-' + param.country.toUpperCase() + '-' + param.regionCode;

Export.table.toDrive({
  collection:  statsExport,
  description: exportDescription,
  fileFormat:  'CSV',
  folder:      'STATS-FLOODED'
});

// ==============================================================================
// 6. VISUALIZATION
// ==============================================================================

var visParams = {
  bands:   ['classification_' + param.previewYear],
  min:     0,
  max:     mapbiomasPalette.length - 1,
  palette: mapbiomasPalette
};

Map.addLayer(regionData.style({ fillColor: '00000000', color: 'red' }), {}, 'Region Border', true);
if (param.versionRF) {
  Map.addLayer(classRFImg, visParams, 'RF Baseline - ' + param.previewYear, false);
}
Map.addLayer(classJoinImg, visParams, 'Join-Filter Baseline - ' + param.previewYear, false);
