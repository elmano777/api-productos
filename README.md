# API Productos - Microservicio Multi-tenant (Medicinas)

Este microservicio maneja la gestión de productos farmacéuticos con soporte multi-tenant usando AWS Lambda, DynamoDB y autenticación JWT.

## Características

- ✅ Multi-tenancy (soporte para múltiples inquilinos)
- ✅ Serverless con AWS Lambda (Node.js 18.x)
- ✅ Protección con tokens JWT
- ✅ CRUD completo de productos farmacéuticos
- ✅ Paginación en listado de productos
- ✅ DynamoDB Streams habilitado para CDC
- ✅ CORS habilitado
- ✅ Despliegue automatizado con Serverless Framework

## Endpoints

### 1. Listar Productos (Paginado)
- **URL**: `GET /productos`
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `limit`: Número de productos por página (default: 10)
  - `lastKey`: Clave para paginación (URL encoded)
- **Respuesta**:
```json
{
  "productos": [...],
  "count": 10,
  "lastEvaluatedKey": "encoded_key_for_next_page"
}
```

### 2. Crear Producto
- **URL**: `POST /productos`
- **Headers**: `Authorization: Bearer <token>`
- **Body**:
```json
{
  "nombre": "Paracetamol",
  "descripcion": "Analgésico y antipirético",
  "categoria": "Analgésicos",
  "laboratorio": "Bayer",
  "precio": 15.50,
  "stock": 100,
  "principio_activo": "Paracetamol",
  "concentracion": "500mg",
  "forma_farmaceutica": "Tabletas",
  "presentacion": "Caja x 20 tabletas",
  "registro_sanitario": "EE-12345",
  "requiere_receta": false,
  "fecha_vencimiento": "2026-12-31",
  "contraindicaciones": "No usar con alcohol",
  "indicaciones": "Tomar cada 8 horas",
  "imagen_url": "https://ejemplo.com/imagen.jpg"
}
```

### 3. Buscar Producto por Código
- **URL**: `GET /productos/{codigo}`
- **Headers**: `Authorization: Bearer <token>`
- **Ejemplo**: `GET /productos/MED-ABC123`

### 4. Modificar Producto
- **URL**: `PUT /productos/{codigo}`
- **Headers**: `Authorization: Bearer <token>`
- **Body**: Campos a actualizar (parcial)
```json
{
  "precio": 18.00,
  "stock": 50,
  "descripcion": "Nueva descripción"
}
```

### 5. Eliminar Producto
- **URL**: `DELETE /productos/{codigo}`
- **Headers**: `Authorization: Bearer <token>`
- **Nota**: Eliminación lógica (marca como inactivo)

## Estructura de Datos - Medicinas

### Campos del Producto
- `tenant_id`: Identificador del inquilino
- `codigo`: Código único del producto (auto-generado)
- `nombre`: Nombre comercial del medicamento
- `descripcion`: Descripción del producto
- `categoria`: Categoría farmacéutica (Analgésicos, Antibióticos, etc.)
- `laboratorio`: Laboratorio fabricante
- `precio`: Precio del producto
- `stock`: Cantidad disponible
- `principio_activo`: Componente activo principal
- `concentracion`: Concentración del principio activo
- `forma_farmaceutica`: Tabletas, Jarabe, Cápsulas, etc.
- `presentacion`: Descripción del empaque
- `registro_sanitario`: Número de registro DIGEMID
- `requiere_receta`: Booleano si requiere receta médica
- `fecha_vencimiento`: Fecha de vencimiento
- `contraindicaciones`: Contraindicaciones del medicamento
- `indicaciones`: Indicaciones de uso
- `imagen_url`: URL de la imagen del producto
- `activo`: Estado del producto
- `fecha_creacion`: Timestamp de creación
- `fecha_actualizacion`: Timestamp de última actualización

## Instalación y Despliegue

### Prerrequisitos
- Node.js 18+
- AWS CLI configurado
- Serverless Framework

### Comandos de Despliegue

```bash
# Instalar dependencias
npm install

# Desplegar a desarrollo
npm run deploy-dev

# Desplegar a testing
npm run deploy-test

# Desplegar a producción
npm run deploy-prod

# Ver información del despliegue
npm run info

# Ver logs de una función específica
npm run logs listar-productos

# Desarrollo local
npm run offline
```

## Estructura del Proyecto

```
api-productos/
├── productos.js         # Funciones Lambda
├── serverless.yml       # Configuración Serverless
├── package.json        # Dependencias y scripts
└── README.md           # Documentación
```

## Variables de Entorno

- `TABLE_NAME`: Nombre de la tabla DynamoDB (auto-generado por stage)
- `JWT_SECRET`: Secreto para validar tokens JWT (debe coincidir con api-usuarios)

## Tabla DynamoDB

**Nombre**: `{stage}-t_productos`

**Schema**:
- **Partition Key**: `tenant_id` (String)
- **Sort Key**: `codigo` (String)

**Características**:
- DynamoDB Streams habilitado (NEW_AND_OLD_IMAGES)
- Global Secondary Index: `tenant_id-index` para consultas eficientes
- Billing Mode: PAY_PER_REQUEST

## Seguridad

- Todos los endpoints requieren token JWT válido
- Validación de tenant_id desde el token
- Aislamiento de datos por tenant
- Eliminación lógica de productos
- CORS configurado para frontend

## Ejemplos de Uso

### Crear Producto de Medicina
```bash
curl -X POST https://tu-api-url/productos \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Ibuprofeno 400mg",
    "descripcion": "Antiinflamatorio no esteroideo",
    "categoria": "Antiinflamatorios",
    "laboratorio": "Pfizer",
    "precio": 12.50,
    "stock": 200,
    "principio_activo": "Ibuprofeno",
    "concentracion": "400mg",
    "forma_farmaceutica": "Tabletas",
    "presentacion": "Caja x 30 tabletas",
    "registro_sanitario": "EE-67890",
    "requiere_receta": false
  }'
```

### Listar Productos con Paginación
```bash
curl -X GET "https://tu-api-url/productos?limit=5" \
  -H "Authorization: Bearer <token>"
```

### Buscar Producto por Código
```bash
curl -X GET https://tu-api-url/productos/MED-ABC123 \
  -H "Authorization: Bearer <token>"
```

### Actualizar Stock
```bash
curl -X PUT https://tu-api-url/productos/MED-ABC123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "stock": 75,
    "precio": 13.00
  }'
```

## Integración con DynamoDB Streams

La tabla tiene DynamoDB Streams habilitado para:
- Sincronización con ElasticSearch (búsqueda)
- Auditoría de cambios
- Integración con otros microservicios

## Categorías de Medicinas Sugeridas

- Analgésicos
- Antiinflamatorios
- Antibióticos
- Antihistamínicos
- Vitaminas y Suplementos
- Medicamentos Cardiovasculares
- Medicamentos Respiratorios
- Medicamentos Digestivos
- Productos de Cuidado Personal
- Medicamentos Dermatológicos