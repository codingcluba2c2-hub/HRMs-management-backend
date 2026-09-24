import swaggerJsdoc from 'swagger-jsdoc';

// Configuration settings for our automatic API Documentation (Swagger)
const options: swaggerJsdoc.Options = {
  definition: {
    // We are using OpenAPI version 3
    openapi: '3.0.0',
    // Basic information about the API shown at the top of the documentation page
    info: {
      title: 'HRMS API Documentation',
      version: '1.0.0',
      description: 'Enterprise HRMS Backend API Documentation',
      contact: {
        name: 'Developer Team',
      },
    },
    // The servers where this API is hosted
    servers: [
      {
        url: 'http://localhost:6002',
        description: 'Development Server',
      },
      {
        url: 'https://staging-hrms-api.example.com',
        description: 'UAT Server',
      },
      {
        url: 'https://api.example.com',
        description: 'Production Server',
      },
    ],
    // Reusable components across all our API endpoints
    components: {
      // Setup the "Authorize" button so developers can test APIs with a token
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token.',
        },
      },
      // Standard reusable error responses
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: false },
                  message: { type: 'string', example: 'Unauthorized' },
                },
              },
            },
          },
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: false },
                  message: { type: 'string', example: 'Internal server error' },
                },
              },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: false },
                  message: { type: 'string', example: 'Resource not found' },
                },
              },
            },
          },
        },
      },
    },
    // Apply the Bearer Token security globally to all routes by default
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  // Automatically search these route files for swagger comment blocks to generate the docs
  apis: ['./src/modules/**/*.route.ts'],
};

// Generate and export the final swagger specification object
export const swaggerSpec = swaggerJsdoc(options);
