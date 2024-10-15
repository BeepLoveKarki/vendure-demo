import { gql } from 'apollo-angular';

const PRODUCT_LIST_QUERY_PRODUCT_FRAGMENT = gql`
    fragment ProductListQueryProductFragment on Product {
        id
        createdAt
        updatedAt
        enabled
        languageCode
        name
        slug
        featuredAsset {
            id
            createdAt
            updatedAt
            preview
            focalPoint {
                x
                y
            }
        }
    }
`;

export const TO_BE_EMPTY_COLLECTIONS_QUERY = gql`
    query ToBeEmptyCollectionsQuery($productIDs: [ID!]!) {
        toBeEmptyCollections(productIDs: $productIDs) {
            id
            name
        }
    }
`;

export const PRODUCT_LIST_QUERY = gql`
    query ProductListQuery($options: ProductListOptions) {
        products(options: $options) {
            items {
                ...ProductListQueryProductFragment
            }
            totalItems
        }
    }
    ${PRODUCT_LIST_QUERY_PRODUCT_FRAGMENT}
`;
