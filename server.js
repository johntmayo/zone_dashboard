const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files from current directory

// Google Sheets API setup
// Using public sheet access (no auth needed if sheet is set to "Anyone with link can view")
const CENTRAL_SHEET_ID = '1PaqcX2BSypJjLBDMA3DnlAxCHK5y0TWMSbCIkTScIQU';

// Helper function to fetch Google Sheet data (public access)
async function fetchPublicSheet(sheetId, range = 'A1:ZZ1000') {
  try {
    // For public sheets, we can use CSV export
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    const https = require('https');
    const http = require('http');
    
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        let csvText = '';
        response.on('data', (chunk) => {
          csvText += chunk.toString();
        });
        
        response.on('end', () => {
          try {
            // Parse CSV
            const lines = csvText.split('\n').filter(line => line.trim());
            if (lines.length === 0) {
              resolve({ headers: [], rows: [] });
              return;
            }
            
            // Parse header
            const headers = parseCSVLine(lines[0]);
            
            // Parse rows
            const rows = lines.slice(1).map(line => {
              const values = parseCSVLine(line);
              const row = {};
              headers.forEach((header, index) => {
                row[header] = values[index] || '';
              });
              return row;
            });
            
            resolve({ headers, rows });
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  } catch (error) {
    console.error('Error fetching sheet:', error);
    throw error;
  }
}

// Simple CSV parser (handles quoted fields)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  result.push(current.trim());
  
  return result;
}

// API Route: Homepage Feed
app.get('/api/homepage-feed', async (req, res) => {
  try {
    console.log('Fetching homepage feed from central sheet...');
    
    // Fetch the central sheet data
    const { headers, rows } = await fetchPublicSheet(CENTRAL_SHEET_ID);
    
    // The sheet structure: Column A has labels, Column B has content
    // Row 1: Announcements | content
    // Row 2: Next Meeting | content
    // Row 3: Newsletter | content
    // Row 4: Volunteer Asks | content
    // Row 5: Partner Items | content
    
    const result = {
      next_meeting: {
        date: '',
        time: '',
        location: '',
        description: ''
      },
      newsletter: {
        title: '',
        url: ''
      },
      volunteer_asks: [],
      partner_items: []
    };
    
    // Process rows - column A is label, column B is content
    const labelCol = headers[0] || '';
    const contentCol = headers[1] || '';
    
    rows.forEach((row, index) => {
      const label = (row[labelCol] || '').trim();
      const labelLower = label.toLowerCase();
      const content = (row[contentCol] || '').trim();
      
      if (labelLower.includes('next meeting') || (labelLower.includes('meeting') && !labelLower.includes('volunteer'))) {
        result.next_meeting.description = content;
        // Check for additional columns (date, time, location)
        if (headers[2]) result.next_meeting.date = (row[headers[2]] || '').trim();
        if (headers[3]) result.next_meeting.time = (row[headers[3]] || '').trim();
        if (headers[4]) result.next_meeting.location = (row[headers[4]] || '').trim();
      } else if (labelLower.includes('newsletter')) {
        result.newsletter.title = content;
        // Check for URL column
        if (headers[2]) result.newsletter.url = (row[headers[2]] || '').trim();
      } else if (labelLower.includes('volunteer')) {
        const volunteerItem = {
          title: content,
          description: headers[2] ? (row[headers[2]] || '').trim() : '',
          url: headers[3] ? (row[headers[3]] || '').trim() : ''
        };
        if (volunteerItem.title || volunteerItem.description) {
          result.volunteer_asks.push(volunteerItem);
        }
      } else if (labelLower.includes('partner')) {
        const partnerItem = {
          title: content,
          description: headers[2] ? (row[headers[2]] || '').trim() : '',
          url: headers[3] ? (row[headers[3]] || '').trim() : ''
        };
        if (partnerItem.title || partnerItem.description) {
          result.partner_items.push(partnerItem);
        }
      }
    });
    
    // If structure doesn't match expected format, try direct row access
    // Row indices are 0-based, but we skip header, so:
    // Row 0 (first data row) = Announcements
    // Row 1 = Next Meeting
    // Row 2 = Newsletter
    // Row 3 = Volunteer Asks
    // Row 4 = Partner Items
    if (rows.length > 0 && !result.next_meeting.description && rows.length >= 2) {
      // Try index-based access
      if (rows[1] && rows[1][contentCol]) {
        result.next_meeting.description = rows[1][contentCol] || '';
      }
      if (rows.length >= 3 && rows[2] && rows[2][contentCol]) {
        result.newsletter.title = rows[2][contentCol] || '';
      }
    }
    
    console.log('Homepage feed fetched successfully');
    res.json(result);
  } catch (error) {
    console.error('Error fetching homepage feed:', error);
    res.status(500).json({ 
      error: 'Failed to fetch homepage feed',
      message: error.message 
    });
  }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Central sheet ID: ${CENTRAL_SHEET_ID}`);
});

