// Test script for filter functionality
// This script can be run in the browser console to test all filter scenarios

console.log('🧪 Starting Filter Tests for Request General Page');

// Test data
const testFilters = {
  status: ['Pendiente', 'En Progreso', 'Completada', ''],
  company: ['1', '2', ''],
  date_from: ['2024-01-01', '2024-12-31', ''],
  date_to: ['2024-01-01', '2024-12-31', ''],
  assigned_to: ['User1', 'User2', ''],
};

// Test functions
const testFilterCombinations = () => {
  console.log('🔍 Testing filter combinations...');

  // Test individual filters
  Object.keys(testFilters).forEach((filterKey) => {
    testFilters[filterKey].forEach((value) => {
      console.log(`Testing ${filterKey} with value: ${value || 'empty'}`);
      // Simulate filter change
      const filterElement = document.querySelector(`[data-testid="${filterKey}-filter"]`);
      if (filterElement) {
        filterElement.value = value;
        filterElement.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  // Test multiple filters together
  console.log('Testing multiple filters together...');
  const combinations = [
    { status: 'Pendiente', company: '1' },
    { date_from: '2024-01-01', date_to: '2024-12-31' },
    { status: 'En Progreso', assigned_to: 'User1' },
    { status: 'Completada', company: '2', date_from: '2024-01-01' },
  ];

  combinations.forEach((combo, index) => {
    console.log(`Testing combination ${index + 1}:`, combo);
    Object.keys(combo).forEach((key) => {
      const filterElement = document.querySelector(`[data-testid="${key}-filter"]`);
      if (filterElement) {
        filterElement.value = combo[key];
        filterElement.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });
};

const testClearFilters = () => {
  console.log('🧹 Testing clear filters functionality...');

  // Set some filters first
  const filtersToSet = {
    status: 'Pendiente',
    company: '1',
    date_from: '2024-01-01',
    date_to: '2024-12-31',
    assigned_to: 'User1',
  };

  Object.keys(filtersToSet).forEach((key) => {
    const filterElement = document.querySelector(`[data-testid="${key}-filter"]`);
    if (filterElement) {
      filterElement.value = filtersToSet[key];
      filterElement.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Click clear filters button
  const clearButton = document.querySelector('[data-testid="clear-filters"]');
  if (clearButton) {
    clearButton.click();

    // Verify all filters are cleared
    setTimeout(() => {
      Object.keys(filtersToSet).forEach((key) => {
        const filterElement = document.querySelector(`[data-testid="${key}-filter"]`);
        if (filterElement) {
          console.log(`${key} filter value after clear: ${filterElement.value}`);
        }
      });
    }, 1000);
  }
};

const testEdgeCases = () => {
  console.log('⚠️ Testing edge cases...');

  // Test invalid date range
  console.log('Testing invalid date range (from > to)');
  const dateFromElement = document.querySelector('[data-testid="date_from-filter"]');
  const dateToElement = document.querySelector('[data-testid="date_to-filter"]');

  if (dateFromElement && dateToElement) {
    dateFromElement.value = '2024-12-31';
    dateToElement.value = '2024-01-01';

    dateFromElement.dispatchEvent(new Event('change', { bubbles: true }));
    dateToElement.dispatchEvent(new Event('change', { bubbles: true }));

    // Try to apply filters
    const applyButton = document.querySelector('[data-testid="apply-filters"]');
    if (applyButton) {
      applyButton.click();
    }
  }

  // Test empty filters
  console.log('Testing empty filters');
  const applyButton = document.querySelector('[data-testid="apply-filters"]');
  if (applyButton) {
    applyButton.click();
  }

  // Test invalid company selection
  console.log('Testing invalid company selection');
  const companyElement = document.querySelector('[data-testid="company-filter"]');
  if (companyElement) {
    companyElement.value = '999999';
    companyElement.dispatchEvent(new Event('change', { bubbles: true }));

    if (applyButton) {
      applyButton.click();
    }
  }
};

const testUIResponsiveness = () => {
  console.log('📱 Testing UI responsiveness...');

  // Test filter expansion/collapse
  const filterToggle = document.querySelector('[data-testid="filter-toggle"]');
  if (filterToggle) {
    filterToggle.click();
    setTimeout(() => {
      const filterSection = document.querySelector('[data-testid="filter-section"]');
      console.log('Filter section visible:', filterSection ? 'Yes' : 'No');

      filterToggle.click();
      setTimeout(() => {
        console.log('Filter section visible after collapse:', filterSection ? 'Yes' : 'No');
      }, 500);
    }, 500);
  }

  // Test loading states
  const applyButton = document.querySelector('[data-testid="apply-filters"]');
  if (applyButton) {
    applyButton.click();
    console.log('Apply button loading state:', applyButton.disabled ? 'Yes' : 'No');
  }
};

const checkConsoleErrors = () => {
  console.log('🐛 Checking for console errors...');

  // Override console.error to catch errors
  const originalError = console.error;
  let errorCount = 0;

  console.error = function (...args) {
    errorCount++;
    originalError.apply(console, args);
  };

  // Run some filter operations
  testFilterCombinations();

  setTimeout(() => {
    console.error = originalError;
    console.log(`Total console errors detected: ${errorCount}`);
  }, 2000);
};

// Run all tests
const runAllTests = () => {
  console.log('🚀 Running all filter tests...');

  testFilterCombinations();
  setTimeout(testClearFilters, 1000);
  setTimeout(testEdgeCases, 2000);
  setTimeout(testUIResponsiveness, 3000);
  setTimeout(checkConsoleErrors, 4000);

  setTimeout(() => {
    console.log('✅ All tests completed!');
    console.log('📊 Test Summary:');
    console.log('- Filter combinations tested');
    console.log('- Clear filters functionality tested');
    console.log('- Edge cases tested');
    console.log('- UI responsiveness tested');
    console.log('- Console errors checked');
  }, 5000);
};

// Auto-run tests if on the correct page
if (window.location.pathname.includes('/process/request-general/create-request')) {
  runAllTests();
} else {
  console.log('⚠️ Please navigate to the request general create page to run tests');
}

// Export functions for manual testing
window.filterTests = {
  runAllTests,
  testFilterCombinations,
  testClearFilters,
  testEdgeCases,
  testUIResponsiveness,
  checkConsoleErrors,
};

console.log('🔧 Filter test functions loaded. Use window.filterTests to access them.');
