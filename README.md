# API Productos - Microservicio Multi-tenant para Inkafarma

Este microservicio maneja la gestión de productos (medicinas) con soporte multi-tenant usando AWS Lambda, DynamoDB y autenticación JWT.

## Características

- ✅ Multi-tenancy (soporte para múltiples inquilinos)
- ✅ Serverless con AWS Lambda
- ✅ Protegido con autenticación JWT
- ✅ CRUD completo de productos
- ✅ Paginación en listado
- ✅ DynamoDB Streams habilitado
- ✅ CORS habilitado
- ✅ Despliegue automatizado con Serverless Framework
- ✅ Manejo de imágenes con S3
- ✅ URLs presignadas para subida directa de imágenes

## Estructura de Productos

Cada producto contiene:
- **código**: Código único generado automáticamente (MED-xxxxx)
- **nombre**: Nombre del medicamento
- **precio**: Precio en soles (número decimal)
- **descripcion**: Descripción del producto
- **imagen_url**: URL de la imagen en S3
- **tenant_id**: Identificador del inquilino
- **fecha_creacion**: Timestamp de creación
- **fecha_modificacion**: Timestamp de última modificación
- **activo**: Estado del producto

## Endpoints

### 1. Listar Productos (Paginado)
- **URL**: `GET /productos/listar`
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `limit` (opcional): Número de productos por página (default: 20)
  - `lastKey` (opcional): Clave para paginación
- **Respuesta**:
```json
{
  "productos": [...],
  "count": 20,
  "nextKey": "base64_encoded_key",
  "hasMore": true
}
```

### 2. Crear Producto
- **URL**: `POST /productos/crear`
- **Headers**: `Authorization: Bearer <token>`
- **Body**:
```json
{
  "nombre": "Paracetamol 500mg",
  "precio": 12.50,
  "descripcion": "Analgésico y antipirético para dolores leves a moderados",
  "imagen_url": "https://s3.amazonaws.com/mi-bucket/paracetamol.jpg"
}
```

### 3. Buscar Producto por Código
- **URL**: `GET /productos/buscar/{codigo}`
- **Headers**: `Authorization: Bearer <token>`
- **Respuesta**:
```json
{
  "producto": {
    "tenant_id": "inkafarma",
    "codigo": "MED-ABC123",
    "nombre": "Paracetamol 500mg",
    "precio": 12.50,
    "descripcion": "Analgésico y antipirético",
    "imagen_url": "https://s3.amazonaws.com/...",
    "fecha_creacion": "2025-06-14T10:30:00Z",
    "activo": true
  }
}
```

### 4. Modificar Producto
- **URL**: `PUT /productos/modificar/{codigo}`
- **Headers**: `Authorization: Bearer <token>`
- **Body** (campos opcionales):
```json
{
  "nombre": "Paracetamol 500mg - Nuevo",
  "precio": 15.00,
  "descripcion": "Nueva descripción",
  "imagen_url": "https://s3.amazonaws.com/nueva-imagen.jpg",
  "activo": true
}
```

### 5. Eliminar Producto
- **URL**: `DELETE /productos/eliminar/{codigo}`
- **Headers**: `Authorization: Bearer <token>`

### 6. Subir Imagen
- **URL**: `POST /productos/subir-imagen`
- **Headers**: `Authorization: Bearer <token>`
- **Body**:
```json
{
  "imagen": "base64_encoded_image",
  "codigo_producto": "MED-ABC123"
}
```
- **Respuesta**:
```json
{
  "message": "Imagen subida exitosamente",
  "imagen_url": "https://s3.amazonaws.com/...",
  "key": "productos/tenant/codigo/timestamp.ext"
}
```

### 7. Generar URL de Subida
- **URL**: `GET /productos/generar-url-subida`
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `codigo_producto`: Código del producto
  - `tipo_archivo`: Tipo de archivo (jpg, jpeg, png, gif, webp)
- **Respuesta**:
```json
{
  "upload_url": "https://s3.amazonaws.com/...",
  "public_url": "https://s3.amazonaws.com/...",
  "expires_in": 600
}
```

## Instalación y Despliegue

### Prerrequisitos
- Node.js 18+
- AWS CLI configurado
- Serverless Framework
- Token JWT válido del microservicio de usuarios
- Bucket S3 configurado para almacenamiento de imágenes

### Variables de Entorno

- `TABLE_NAME`: Nombre de la tabla DynamoDB (auto-generado por stage)
- `JWT_SECRET`: Secreto para validar tokens JWT
- `BUCKET_NAME`: Nombre del bucket S3 para imágenes

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

# Ver logs de funciones específicas
npm run logs-crear
npm run logs-listar
npm run logs-buscar
npm run logs-modificar
npm run logs-eliminar
npm run logs-subir-imagen
npm run logs-generar-url
```

## Estructura del Proyecto

```
api-productos/
├── productos.js         # Funciones Lambda
├── serverless.yml       # Configuración Serverless
├── package.json        # Configuración del proyecto
└── README.md           # Documentación
```

## Tabla DynamoDB

**Nombre**: `{stage}-t_productos`

**Schema**:
- **Partition Key**: `tenant_id` (String)
- **Sort Key**: `codigo` (String)
- **Streams**: Habilitado con NEW_AND_OLD_IMAGES

**Campos**:
- `tenant_id`: Identificador del inquilino
- `codigo`: Código único del producto (auto-generado)
- `nombre`: Nombre del producto
- `precio`: Precio en soles (Number)
- `descripcion`: Descripción del producto
- `imagen_url`: URL de imagen en S3
- `fecha_creacion`: Timestamp de creación
- `fecha_modificacion`: Timestamp de última modificación
- `activo`: Estado del producto (Boolean)

## Manejo de Imágenes

### Formatos Soportados
- JPG/JPEG
- PNG
- GIF
- WEBP

### Límites
- Tamaño máximo: 5MB
- Tipos MIME soportados: image/jpeg, image/png, image/gif, image/webp

### Estructura de Almacenamiento
Las imágenes se almacenan en S3 con la siguiente estructura:
```
s3://{bucket_name}/productos/{tenant_id}/{codigo_producto}/{timestamp}.{extension}
```

## Seguridad

- Todos los endpoints requieren token JWT válido
- Validación de tenant_id desde el token
- Validación de tipos de datos y campos requeridos
- CORS habilitado para frontend
- Multi-tenancy para aislamiento de datos
- Validación de tipos de archivo y tamaño para imágenes
- URLs presignadas con expiración para subida directa

## Códigos de Estado HTTP

- `200`: Operación exitosa
- `201`: Producto creado exitosamente
- `400`: Datos inválidos o faltantes
- `401`: Token inválido o expirado
- `404`: Producto no encontrado
- `500`: Error interno del servidor