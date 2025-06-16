import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import jwt from 'jsonwebtoken';

// Clientes AWS
const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);
const s3 = new S3Client({});
const tableName = process.env.TABLE_NAME;
const bucketName = process.env.BUCKET_NAME;
const jwtSecret = process.env.JWT_SECRET;

// Función helper para respuestas consistentes
const lambdaResponse = (statusCode, body) => {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify(body)
    };
};

// Función para validar token JWT
const validarToken = (event) => {
    try {
        let token = null;
        
        // Buscar token en headers Authorization
        if (event.headers && event.headers.Authorization) {
            const authHeader = event.headers.Authorization;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }
        
        // Buscar token en headers authorization (minúscula)
        if (!token && event.headers && event.headers.authorization) {
            const authHeader = event.headers.authorization;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }
        
        if (!token) {
            return { valid: false, error: 'Token requerido' };
        }
        
        const payload = jwt.verify(token, jwtSecret);
        return { valid: true, usuario: payload };
        
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return { valid: false, error: 'Token expirado' };
        } else if (error.name === 'JsonWebTokenError') {
            return { valid: false, error: 'Token inválido' };
        }
        return { valid: false, error: 'Error validando token' };
    }
};

// Función para generar código único de producto
const generarCodigoProducto = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `MED-${timestamp}-${random}`.toUpperCase();
};

// Función para generar nombre único de archivo
const generarNombreArchivo = (tenantId, codigo, extension) => {
    const timestamp = Date.now();
    return `productos/${tenantId}/${codigo}/${timestamp}.${extension}`;
};

// Función para procesar form-data
const procesarFormData = (body) => {
    try {
        const boundary = body.split('\r\n')[0];
        const parts = body.split(boundary);
        const result = {};
        
        for (const part of parts) {
            if (part.includes('Content-Disposition: form-data')) {
                const nameMatch = part.match(/name="([^"]+)"/);
                if (nameMatch) {
                    const name = nameMatch[1];
                    // Extraer el contenido después de los headers
                    const contentMatch = part.match(/\r\n\r\n([\s\S]*?)(?=\r\n--)/);
                    if (contentMatch) {
                        let value = contentMatch[1];
                        // Si es un archivo, mantener el contenido binario
                        if (part.includes('filename=')) {
                            result[name] = value;
                        } else {
                            // Si no es un archivo, trimear el valor
                            value = value.trim();
                            result[name] = value;
                        }
                    }
                }
            }
        }
        return result;
    } catch (error) {
        console.error('Error procesando form-data:', error);
        throw new Error('Error procesando form-data');
    }
};

// Función para detectar tipo de archivo por su contenido
const detectarTipoImagen = (base64String) => {
    // Limpiar el string base64 de posibles headers
    const cleanBase64 = base64String.replace(/^data:image\/\w+;base64,/, '');
    
    if (cleanBase64.startsWith('/9j/')) return { ext: 'jpg', mime: 'image/jpeg' };
    if (cleanBase64.startsWith('iVBORw0KGgo')) return { ext: 'png', mime: 'image/png' };
    if (cleanBase64.startsWith('R0lGODlh')) return { ext: 'gif', mime: 'image/gif' };
    if (cleanBase64.startsWith('UklGR')) return { ext: 'webp', mime: 'image/webp' };
    return null;
};

// Función para validar y procesar imagen base64
const procesarImagenBase64 = (base64String) => {
    try {
        // Limpiar el string base64 de posibles headers
        const cleanBase64 = base64String.replace(/^data:image\/\w+;base64,/, '');
        
        // Validar que sea base64 válido
        if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
            throw new Error('Formato base64 inválido');
        }
        
        // Detectar tipo de imagen
        const tipoImagen = detectarTipoImagen(cleanBase64);
        if (!tipoImagen) {
            throw new Error('Formato de imagen no soportado. Solo JPG, PNG, GIF, WEBP');
        }
        
        // Convertir a buffer y validar tamaño
        const imageBuffer = Buffer.from(cleanBase64, 'base64');
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (imageBuffer.length > maxSize) {
            throw new Error('Imagen muy grande. Máximo 5MB');
        }
        
        return {
            buffer: imageBuffer,
            tipo: tipoImagen
        };
    } catch (error) {
        throw new Error(`Error procesando imagen: ${error.message}`);
    }
};

// Subir imagen a S3
export async function subirImagen(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return lambdaResponse(400, { error: 'JSON inválido' });
        }
        
        // Validar campos requeridos
        if (!body.imagen || !body.codigo_producto) {
            return lambdaResponse(400, { error: 'Campos requeridos: imagen (base64), codigo_producto' });
        }
        
        // Detectar tipo de imagen
        const tipoImagen = detectarTipoImagen(body.imagen);
        if (!tipoImagen) {
            return lambdaResponse(400, { error: 'Formato de imagen no soportado. Solo JPG, PNG, GIF, WEBP' });
        }
        
        // Convertir base64 a buffer
        let imageBuffer;
        try {
            imageBuffer = Buffer.from(body.imagen, 'base64');
        } catch (e) {
            return lambdaResponse(400, { error: 'Imagen base64 inválida' });
        }
        
        // Validar tamaño (máximo 5MB)
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (imageBuffer.length > maxSize) {
            return lambdaResponse(400, { error: 'Imagen muy grande. Máximo 5MB' });
        }
        
        // Generar nombre único del archivo
        const nombreArchivo = generarNombreArchivo(tenantId, body.codigo_producto, tipoImagen.ext);
        
        // Subir a S3
        const uploadParams = {
            Bucket: bucketName,
            Key: nombreArchivo,
            Body: imageBuffer,
            ContentType: tipoImagen.mime,
            ACL: 'public-read' // Para que sea accesible públicamente
        };
        
        const uploadResult = await s3.send(new PutObjectCommand(uploadParams));
        
        return lambdaResponse(200, {
            message: 'Imagen subida exitosamente',
            imagen_url: uploadResult.Location,
            key: nombreArchivo
        });
        
    } catch (error) {
        console.error('Error subiendo imagen:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Generar URL presignada para subida directa (alternativa)
export async function generarUrlSubida(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const queryParams = event.queryStringParameters || {};
        
        if (!queryParams.codigo_producto || !queryParams.tipo_archivo) {
            return lambdaResponse(400, { error: 'Parámetros requeridos: codigo_producto, tipo_archivo' });
        }
        
        const tiposPermitidos = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const tipoArchivo = queryParams.tipo_archivo.toLowerCase();
        
        if (!tiposPermitidos.includes(tipoArchivo)) {
            return lambdaResponse(400, { error: 'Tipo de archivo no permitido' });
        }
        
        const nombreArchivo = generarNombreArchivo(tenantId, queryParams.codigo_producto, tipoArchivo);
        
        // Generar URL presignada (válida por 10 minutos)
        const signedUrl = s3.getSignedUrl('putObject', {
            Bucket: bucketName,
            Key: nombreArchivo,
            ContentType: `image/${tipoArchivo === 'jpg' ? 'jpeg' : tipoArchivo}`,
            ACL: 'public-read',
            Expires: 600 // 10 minutos
        });
        
        const publicUrl = `https://${bucketName}.s3.amazonaws.com/${nombreArchivo}`;
        
        return lambdaResponse(200, {
            upload_url: signedUrl,
            public_url: publicUrl,
            expires_in: 600
        });
        
    } catch (error) {
        console.error('Error generando URL presignada:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Listar productos con paginación
export async function listarProductos(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const queryParams = event.queryStringParameters || {};
        const limit = parseInt(queryParams.limit) || 20;
        let lastEvaluatedKey = null;
        
        if (queryParams.lastKey) {
            try {
                lastEvaluatedKey = JSON.parse(Buffer.from(queryParams.lastKey, 'base64').toString());
            } catch (e) {
                return lambdaResponse(400, { error: 'lastKey inválido' });
            }
        }
        
        const params = {
            TableName: tableName,
            KeyConditionExpression: 'tenant_id = :tenant_id',
            ExpressionAttributeValues: {
                ':tenant_id': tenantId
            },
            Limit: limit,
            ScanIndexForward: false // Ordenar por fecha de creación descendente
        };
        
        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const result = await dynamodb.send(new QueryCommand(params));
        
        let nextKey = null;
        if (result.LastEvaluatedKey) {
            nextKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
        }
        
        return lambdaResponse(200, {
            productos: result.Items,
            count: result.Items.length,
            nextKey: nextKey,
            hasMore: !!result.LastEvaluatedKey
        });
        
    } catch (error) {
        console.error('Error listando productos:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Crear producto (puede incluir imagen)
export async function crearProducto(event, context) {
    console.log('EVENTO RECIBIDO:', JSON.stringify(event));
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        
        let body;
        if (typeof event.body === 'string') {
            try {
                body = JSON.parse(event.body);
            } catch (e) {
                return lambdaResponse(400, { error: 'JSON inválido' });
            }
        } else {
            body = event.body;
        }
        
        // Validar campos requeridos
        const requiredFields = ['nombre', 'precio', 'descripcion'];
        for (const field of requiredFields) {
            if (!body[field]) {
                return lambdaResponse(400, { error: `Campo requerido: ${field}` });
            }
        }
        
        // Validar precio
        const precio = parseFloat(body.precio);
        if (isNaN(precio) || precio <= 0) {
            return lambdaResponse(400, { error: 'Precio debe ser un número mayor a 0' });
        }
        
        const codigo = generarCodigoProducto();
        const fechaCreacion = new Date().toISOString();
        
        let imagenUrl = '';
        
        // Si se proporciona imagen en base64
        if (body.imagen) {
            try {
                const imagenProcesada = procesarImagenBase64(body.imagen);
                const nombreArchivo = generarNombreArchivo(tenantId, codigo, imagenProcesada.tipo.ext);
                
                const uploadParams = {
                    Bucket: bucketName,
                    Key: nombreArchivo,
                    Body: imagenProcesada.buffer,
                    ContentType: imagenProcesada.tipo.mime,
                    ACL: 'public-read'
                };
                
                await s3.send(new PutObjectCommand(uploadParams));
                imagenUrl = `https://${bucketName}.s3.amazonaws.com/${nombreArchivo}`;
                
            } catch (error) {
                return lambdaResponse(400, { error: error.message });
            }
        } else if (body.imagen_url) {
            // Si se proporciona URL directamente
            imagenUrl = body.imagen_url;
        }
        
        const producto = {
            tenant_id: tenantId,
            codigo: codigo,
            nombre: body.nombre.trim(),
            precio: precio,
            descripcion: body.descripcion.trim(),
            imagen_url: imagenUrl,
            fecha_creacion: fechaCreacion,
            fecha_modificacion: fechaCreacion,
            activo: true
        };
        
        const params = {
            TableName: tableName,
            Item: producto
        };
        
        await dynamodb.send(new PutCommand(params));
        
        return lambdaResponse(201, {
            message: 'Producto creado exitosamente',
            producto: producto
        });
        
    } catch (error) {
        console.error('Error creando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Buscar producto por código - VERSIÓN CORREGIDA
export async function buscarProducto(event, context) {
    console.log('Evento completo:', JSON.stringify(event, null, 2)); // Debug
    
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        
        // Múltiples formas de obtener el código
        let codigo = null;
        
        // Opción 1: Desde path (tu estructura actual)
        if (event.path && event.path.codigo) {
            codigo = event.path.codigo;
        }
        
        // Opción 2: Desde pathParameters (estructura estándar de API Gateway)
        if (!codigo && event.pathParameters && event.pathParameters.codigo) {
            codigo = event.pathParameters.codigo;
        }
        
        // Opción 3: Desde queryStringParameters (fallback)
        if (!codigo && event.queryStringParameters && event.queryStringParameters.codigo) {
            codigo = event.queryStringParameters.codigo;
        }
        
        // Opción 4: Desde resource path parsing (backup)
        if (!codigo && event.resource) {
            const matches = event.resource.match(/\/productos\/buscar\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        // Opción 5: Desde requestPath parsing (tu estructura actual)
        if (!codigo && event.requestPath) {
            const matches = event.requestPath.match(/\/productos\/buscar\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        // Opción 6: Desde requestContext (otro fallback)
        if (!codigo && event.requestContext && event.requestContext.resourcePath) {
            const matches = event.requestContext.resourcePath.match(/\/productos\/buscar\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        console.log('Código extraído:', codigo); // Debug
        
        if (!codigo) {
            console.log('PathParameters:', event.pathParameters);
            console.log('Path:', event.path);
            console.log('Resource:', event.resource);
            console.log('RequestPath:', event.requestPath);
            console.log('RequestContext:', event.requestContext);
            return lambdaResponse(400, { 
                error: 'Código de producto requerido',
                debug: {
                    pathParameters: event.pathParameters,
                    path: event.path,
                    resource: event.resource,
                    requestPath: event.requestPath
                }
            });
        }
        
        const params = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        console.log('Parámetros DynamoDB:', JSON.stringify(params, null, 2)); // Debug
        
        const result = await dynamodb.send(new GetCommand(params));
        
        if (!result.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        return lambdaResponse(200, {
            producto: result.Item
        });
        
    } catch (error) {
        console.error('Error buscando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Modificar producto (puede incluir nueva imagen)
export async function modificarProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        
        // Múltiples formas de obtener el código
        let codigo = null;
        
        // Opción 1: Desde path
        if (event.path && event.path.codigo) {
            codigo = event.path.codigo;
        }
        
        // Opción 2: Desde pathParameters
        if (!codigo && event.pathParameters && event.pathParameters.codigo) {
            codigo = event.pathParameters.codigo;
        }
        
        // Opción 3: Desde queryStringParameters
        if (!codigo && event.queryStringParameters && event.queryStringParameters.codigo) {
            codigo = event.queryStringParameters.codigo;
        }
        
        // Opción 4: Desde resource path parsing
        if (!codigo && event.resource) {
            const matches = event.resource.match(/\/productos\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        // Opción 5: Desde requestPath parsing
        if (!codigo && event.requestPath) {
            const matches = event.requestPath.match(/\/productos\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        // Opción 6: Desde requestContext
        if (!codigo && event.requestContext && event.requestContext.resourcePath) {
            const matches = event.requestContext.resourcePath.match(/\/productos\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        if (!codigo) {
            console.log('PathParameters:', event.pathParameters);
            console.log('Path:', event.path);
            console.log('Resource:', event.resource);
            console.log('RequestPath:', event.requestPath);
            console.log('RequestContext:', event.requestContext);
            return lambdaResponse(400, { 
                error: 'Código de producto requerido',
                debug: {
                    pathParameters: event.pathParameters,
                    path: event.path,
                    resource: event.resource,
                    requestPath: event.requestPath
                }
            });
        }
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return lambdaResponse(400, { error: 'JSON inválido' });
        }
        
        // Verificar que el producto existe
        const getParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        const existingProduct = await dynamodb.send(new GetCommand(getParams));
        if (!existingProduct.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        // Construir expresión de actualización
        let updateExpression = 'SET fecha_modificacion = :fecha_modificacion';
        let expressionAttributeValues = {
            ':fecha_modificacion': new Date().toISOString()
        };
        let expressionAttributeNames = {};
        
        // Manejar imagen si se proporciona
        if (body.imagen) {
            try {
                const tipoImagen = detectarTipoImagen(body.imagen);
                if (!tipoImagen) {
                    return lambdaResponse(400, { error: 'Formato de imagen no soportado' });
                }
                
                const imageBuffer = Buffer.from(body.imagen, 'base64');
                
                // Validar tamaño
                const maxSize = 5 * 1024 * 1024; // 5MB
                if (imageBuffer.length > maxSize) {
                    return lambdaResponse(400, { error: 'Imagen muy grande. Máximo 5MB' });
                }
                
                // Eliminar imagen anterior si existe
                if (existingProduct.Item.imagen_url) {
                    try {
                        const oldImageKey = existingProduct.Item.imagen_url.split('.com/')[1]; // Extraer key de la URL
                        if (oldImageKey && oldImageKey.startsWith('productos/')) {
                            await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: oldImageKey }));
                        }
                    } catch (deleteError) {
                        console.warn('No se pudo eliminar imagen anterior:', deleteError);
                    }
                }
                
                const nombreArchivo = generarNombreArchivo(tenantId, codigo, tipoImagen.ext);
                
                const uploadParams = {
                    Bucket: bucketName,
                    Key: nombreArchivo,
                    Body: imageBuffer,
                    ContentType: tipoImagen.mime,
                    ACL: 'public-read'
                };
                
                await s3.send(new PutObjectCommand(uploadParams));
                
                updateExpression += `, imagen_url = :imagen_url`;
                expressionAttributeValues[':imagen_url'] = `https://${bucketName}.s3.amazonaws.com/${nombreArchivo}`;
                
            } catch (uploadError) {
                console.error('Error subiendo nueva imagen:', uploadError);
                return lambdaResponse(400, { error: 'Error procesando imagen' });
            }
        }
        
        // Campos que se pueden actualizar (además de imagen)
        const updatableFields = ['nombre', 'precio', 'descripcion', 'imagen_url', 'activo'];
        
        for (const field of updatableFields) {
            if (body[field] !== undefined && field !== 'imagen_url') { // imagen_url se maneja arriba
                if (field === 'precio') {
                    const precio = parseFloat(body[field]);
                    if (isNaN(precio) || precio <= 0) {
                        return lambdaResponse(400, { error: 'Precio debe ser un número mayor a 0' });
                    }
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = precio;
                } else if (field === 'nombre' || field === 'descripcion') {
                    if (typeof body[field] !== 'string' || !body[field].trim()) {
                        return lambdaResponse(400, { error: `${field} no puede estar vacío` });
                    }
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = body[field].trim();
                } else {
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = body[field];
                }
            }
        }
        
        const updateParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        };
        
        if (Object.keys(expressionAttributeNames).length > 0) {
            updateParams.ExpressionAttributeNames = expressionAttributeNames;
        }
        
        const result = await dynamodb.send(new UpdateCommand(updateParams));
        
        return lambdaResponse(200, {
            message: 'Producto modificado exitosamente',
            producto: result.Attributes
        });
        
    } catch (error) {
        console.error('Error modificando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Eliminar producto (incluye eliminación de imagen)
export async function eliminarProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        
        // Múltiples formas de obtener el código
        let codigo = null;
        
        // Opción 1: Desde path
        if (event.path && event.path.codigo) {
            codigo = event.path.codigo;
        }
        
        // Opción 2: Desde pathParameters
        if (!codigo && event.pathParameters && event.pathParameters.codigo) {
            codigo = event.pathParameters.codigo;
        }
        
        // Opción 3: Desde queryStringParameters
        if (!codigo && event.queryStringParameters && event.queryStringParameters.codigo) {
            codigo = event.queryStringParameters.codigo;
        }
        
        // Opción 4: Desde resource path parsing
        if (!codigo && event.resource) {
            const matches = event.resource.match(/\/productos\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        // Opción 5: Desde requestPath parsing
        if (!codigo && event.requestPath) {
            const matches = event.requestPath.match(/\/productos\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        // Opción 6: Desde requestContext
        if (!codigo && event.requestContext && event.requestContext.resourcePath) {
            const matches = event.requestContext.resourcePath.match(/\/productos\/([^\/]+)/);
            if (matches && matches[1]) {
                codigo = matches[1];
            }
        }
        
        if (!codigo) {
            console.log('PathParameters:', event.pathParameters);
            console.log('Path:', event.path);
            console.log('Resource:', event.resource);
            console.log('RequestPath:', event.requestPath);
            console.log('RequestContext:', event.requestContext);
            return lambdaResponse(400, { 
                error: 'Código de producto requerido',
                debug: {
                    pathParameters: event.pathParameters,
                    path: event.path,
                    resource: event.resource,
                    requestPath: event.requestPath
                }
            });
        }
        
        // Obtener producto antes de eliminar
        const getParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        const existingProduct = await dynamodb.send(new GetCommand(getParams));
        if (!existingProduct.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        // Eliminar imagen de S3 si existe
        if (existingProduct.Item.imagen_url) {
            try {
                const imageKey = existingProduct.Item.imagen_url.split('.com/')[1]; // Extraer key de la URL
                if (imageKey && imageKey.startsWith('productos/')) {
                    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: imageKey }));
                }
            } catch (deleteError) {
                console.warn('No se pudo eliminar imagen:', deleteError);
                // Continuar con la eliminación del producto aunque falle la imagen
            }
        }
        
        const deleteParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            },
            ReturnValues: 'ALL_OLD'
        };
        
        const result = await dynamodb.send(new DeleteCommand(deleteParams));
        
        return lambdaResponse(200, {
            message: 'Producto eliminado exitosamente',
            producto_eliminado: result.Attributes
        });
        
    } catch (error) {
        console.error('Error eliminando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}